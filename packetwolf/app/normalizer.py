# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

"""Map Tetragon export JSON to canonical PacketWolf events."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .models import (
    DnsInfo,
    EventKind,
    FileInfo,
    K8sInfo,
    NetworkInfo,
    ProcessInfo,
    SecurityEvent,
    Severity,
)


SENSITIVE_PATHS = (
    "/etc/passwd",
    "/etc/shadow",
    "/etc/sudoers",
    "/root/.ssh",
    "authorized_keys",
)


def _ts(raw: dict[str, Any]) -> datetime:
    for key in ("time", "timestamp", "node_name"):
        val = raw.get(key)
        if isinstance(val, str):
            try:
                return datetime.fromisoformat(val.replace("Z", "+00:00"))
            except ValueError:
                pass
    return datetime.now(timezone.utc)


def _k8s(raw: dict[str, Any]) -> K8sInfo:
    pod = raw.get("pod") or raw.get("kubernetes") or {}
    if isinstance(pod, dict):
        return K8sInfo(
            namespace=str(pod.get("namespace", "")),
            pod=str(pod.get("name", pod.get("pod_name", ""))),
            container=str(pod.get("container", pod.get("container_name", ""))),
            deployment=str(pod.get("workload", pod.get("deployment", ""))),
        )
    return K8sInfo()


def normalize_tetragon(host_id: str, raw: dict[str, Any]) -> SecurityEvent | None:
    """Best-effort normalizer for Tetragon JSON export lines."""
    process_exec = raw.get("process_exec") or raw.get("process") or {}
    process_kprobe = raw.get("process_kprobe") or {}
    process_exit = raw.get("process_exit") or {}
    kprobe = raw.get("kprobe") or raw.get("process_kprobe") or {}
    msg = str(raw.get("message", raw.get("function", "")))

    proc = ProcessInfo()
    if isinstance(process_exec, dict):
        proc = ProcessInfo(
            pid=int(process_exec.get("process", {}).get("pid", process_exec.get("pid", 0)) or 0),
            ppid=int(process_exec.get("parent", {}).get("pid", process_exec.get("ppid", 0)) or 0),
            user=str(process_exec.get("process", {}).get("uid", process_exec.get("user", ""))),
            binary=str(
                process_exec.get("process", {}).get("binary", process_exec.get("binary", ""))
            ),
            args=str(process_exec.get("args", process_exec.get("arguments", ""))),
        )
    elif isinstance(process_kprobe, dict):
        p = process_kprobe.get("process", process_kprobe)
        proc = ProcessInfo(
            pid=int(p.get("pid", 0) or 0),
            ppid=int(p.get("parent_pid", p.get("ppid", 0)) or 0),
            user=str(p.get("user", "")),
            binary=str(p.get("binary", p.get("exec", ""))),
            args=str(p.get("args", "")),
        )

    k8s = _k8s(raw)
    ts = _ts(raw)

    # process exec / fork / clone / exit
    if process_exec or "execve" in msg.lower() or raw.get("node_name"):
        summary = f"{proc.binary or 'process'} started"
        if proc.args:
            summary = f"{proc.binary} {proc.args}".strip()
        return SecurityEvent(
            host_id=host_id,
            timestamp=ts,
            kind=EventKind.PROCESS_EXEC,
            severity=Severity.INFO,
            process=proc,
            k8s=k8s,
            summary=summary,
            raw_tetragon=raw,
        )

    if process_exit:
        return SecurityEvent(
            host_id=host_id,
            timestamp=ts,
            kind=EventKind.PROCESS_EXEC,
            severity=Severity.INFO,
            process=proc,
            k8s=k8s,
            summary=f"process {proc.pid} exited",
            raw_tetragon=raw,
        )

    # network connect / accept / bind / listen
    sock = raw.get("socket") or raw.get("network") or kprobe.get("socket") or {}
    if sock or any(x in msg.lower() for x in ("connect", "accept", "bind", "listen")):
        net = NetworkInfo(
            src_ip=str(sock.get("src_ip", sock.get("source", ""))),
            dst_ip=str(sock.get("dst_ip", sock.get("destination", ""))),
            port=int(sock.get("port", sock.get("dport", sock.get("sport", 0))) or 0),
            protocol=str(sock.get("protocol", "tcp")),
        )
        sev = Severity.INFO
        if net.port in (22, 4444, 8080) and "connect" in msg.lower():
            sev = Severity.MEDIUM
        return SecurityEvent(
            host_id=host_id,
            timestamp=ts,
            kind=EventKind.NETWORK_CONNECT,
            severity=sev,
            process=proc,
            network=net,
            k8s=k8s,
            summary=f"{proc.binary or 'process'} → {net.dst_ip}:{net.port}",
            raw_tetragon=raw,
        )

    # DNS
    dns_raw = raw.get("dns") or kprobe.get("dns") or {}
    if dns_raw or "dns" in msg.lower():
        dns = DnsInfo(
            query=str(dns_raw.get("query", dns_raw.get("question", ""))),
            response=str(dns_raw.get("response", "")),
        )
        sev = Severity.INFO
        if any(x in dns.query for x in ("malicious", "suspicious", ".ru", ".cn")):
            sev = Severity.HIGH
        return SecurityEvent(
            host_id=host_id,
            timestamp=ts,
            kind=EventKind.DNS_QUERY,
            severity=sev,
            process=proc,
            dns=dns,
            k8s=k8s,
            summary=f"{proc.binary or 'process'} → {dns.query}",
            raw_tetragon=raw,
        )

    # file writes on sensitive paths
    file_raw = raw.get("file") or kprobe.get("file") or {}
    path = str(file_raw.get("path", file_raw.get("filename", "")))
    if path or "write" in msg.lower():
        for sens in SENSITIVE_PATHS:
            if sens in path:
                return SecurityEvent(
                    host_id=host_id,
                    timestamp=ts,
                    kind=EventKind.FILE_WRITE,
                    severity=Severity.HIGH,
                    process=proc,
                    file=FileInfo(path=path, action="write"),
                    k8s=k8s,
                    summary=f"Sensitive file modified: {path}",
                    raw_tetragon=raw,
                )

    # privilege escalation
    if any(x in msg.lower() for x in ("sudo", "setuid", "capability", "root")):
        return SecurityEvent(
            host_id=host_id,
            timestamp=ts,
            kind=EventKind.PRIVILEGE_ESC,
            severity=Severity.HIGH,
            process=proc,
            k8s=k8s,
            summary=f"Privilege escalation: {proc.user} → {proc.binary}",
            raw_tetragon=raw,
        )

    return SecurityEvent(
        host_id=host_id,
        timestamp=ts,
        kind=EventKind.SECURITY,
        severity=Severity.INFO,
        process=proc,
        k8s=k8s,
        summary=msg or "security event",
        raw_tetragon=raw,
    )


def normalize_batch(host_id: str, lines: list[dict[str, Any]]) -> list[SecurityEvent]:
    out: list[SecurityEvent] = []
    for line in lines:
        ev = normalize_tetragon(host_id, line)
        if ev:
            out.append(ev)
    return out
