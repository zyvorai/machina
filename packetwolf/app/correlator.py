# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

"""Threat correlation rules — reverse shell, port scan, suspicious DNS, priv-esc chains."""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import timedelta

from .models import EventKind, SecurityEvent, Severity


def correlate_events(events: list[SecurityEvent]) -> list[dict]:
    """Return correlation findings from recent events."""
    findings: list[dict] = []
    by_host: dict[str, list[SecurityEvent]] = defaultdict(list)
    for e in events:
        by_host[e.host_id].append(e)

    for host_id, host_events in by_host.items():
        host_events.sort(key=lambda x: x.timestamp)
        findings.extend(_host_correlations(host_id, host_events))

    findings.extend(_fleet_correlations(events))
    return findings


def _host_correlations(host_id: str, events: list[SecurityEvent]) -> list[dict]:
    out: list[dict] = []
    window = timedelta(minutes=30)

    # Reverse shell: nc/listen + outbound connect
    listeners = [e for e in events if e.kind == EventKind.SECURITY and "4444" in e.summary]
    if listeners:
        out.append({
            "kind": "reverse_shell",
            "host_id": host_id,
            "severity": "critical",
            "summary": "Possible reverse shell detected",
            "detail": listeners[-1].summary,
            "event_ids": [e.id for e in listeners[-3:]],
        })

    # Crypto miner: xmrig/stratum process exec
    miners = [
        e for e in events
        if e.kind == EventKind.PROCESS_EXEC
        and e.process
        and any(x in (e.process.binary or "").lower() + (e.process.args or "").lower()
                for x in ("xmrig", "minerd", "stratum"))
    ]
    if miners:
        out.append({
            "kind": "crypto_miner",
            "host_id": host_id,
            "severity": "high",
            "summary": "Crypto miner process execution detected",
            "detail": miners[-1].summary,
            "event_ids": [e.id for e in miners[-3:]],
        })

    # DNS tunneling: high-entropy long DNS labels
    dns_tunnel = [
        e for e in events
        if e.kind == EventKind.DNS_QUERY
        and e.dns
        and e.dns.query
        and _dns_tunnel_label(e.dns.query)
    ]
    if dns_tunnel:
        out.append({
            "kind": "dns_tunneling",
            "host_id": host_id,
            "severity": "high",
            "summary": f"{len(dns_tunnel)} suspicious high-entropy DNS label(s)",
            "detail": dns_tunnel[-1].summary,
            "event_ids": [e.id for e in dns_tunnel[-5:]],
        })

    # Suspicious DNS cluster
    dns_bad = [
        e for e in events
        if e.kind == EventKind.DNS_QUERY
        and any(x in (e.dns.query or "") for x in ("suspicious", "malicious", ".xyz", ".ru"))
    ]
    if dns_bad:
        out.append({
            "kind": "suspicious_dns",
            "host_id": host_id,
            "severity": "high",
            "summary": f"{len(dns_bad)} suspicious DNS quer(ies)",
            "detail": dns_bad[-1].summary,
            "event_ids": [e.id for e in dns_bad[-5:]],
        })

    # Container escape: sensitive mount + host namespace indicators
    escape_events = [
        e for e in events
        if (e.k8s and e.k8s.namespace)
        and (
            (e.kind == EventKind.FILE_WRITE and e.file and "/proc/" in (e.file.path or ""))
            or (e.summary and "hostPID" in e.summary)
            or (e.summary and "hostNetwork" in e.summary)
        )
    ]
    if escape_events:
        out.append({
            "kind": "container_escape",
            "host_id": host_id,
            "severity": "critical",
            "summary": "Possible container escape indicators",
            "detail": escape_events[-1].summary,
            "event_ids": [e.id for e in escape_events[-3:]],
        })

    # Privilege escalation chain: sudo then sensitive file write
    priv = [e for e in events if e.kind == EventKind.PRIVILEGE_ESC]
    files = [e for e in events if e.kind == EventKind.FILE_WRITE]
    if priv and files:
        t0 = priv[-1].timestamp
        follow = [f for f in files if f.timestamp >= t0 and f.timestamp <= t0 + window]
        if follow:
            out.append({
                "kind": "privilege_escalation_chain",
                "host_id": host_id,
                "severity": "high",
                "summary": "Privilege escalation followed by sensitive file change",
                "detail": f"{priv[-1].summary} → {follow[-1].summary}",
                "event_ids": [priv[-1].id, follow[-1].id],
            })

    # Port scan heuristic: many distinct connect targets in short window
    connects = [e for e in events if e.kind == EventKind.NETWORK_CONNECT][-20:]
    ports = {e.network.port for e in connects if e.network.port}
    if len(ports) >= 5:
        out.append({
            "kind": "port_scan",
            "host_id": host_id,
            "severity": "medium",
            "summary": f"Unusual connect pattern — {len(ports)} distinct ports",
            "detail": connects[-1].summary if connects else "",
            "event_ids": [e.id for e in connects[-5:]],
        })

    return out


def _fleet_correlations(events: list[SecurityEvent]) -> list[dict]:
    """Cross-host correlation rules."""
    out: list[dict] = []
    window = timedelta(minutes=15)
    ssh_by_host: dict[str, list[SecurityEvent]] = defaultdict(list)
    for e in sorted(events, key=lambda x: x.timestamp):
        if e.kind != EventKind.PROCESS_EXEC or not e.process:
            continue
        binary = (e.process.binary or "").lower()
        if any(x in binary for x in ("/ssh", "/scp", "rsync")):
            ssh_by_host[e.host_id].append(e)

    hosts_with_ssh = [h for h, evs in ssh_by_host.items() if len(evs) >= 2]
    if len(hosts_with_ssh) >= 2:
        latest = max((evs[-1] for evs in ssh_by_host.values() if evs), key=lambda x: x.timestamp, default=None)
        if latest:
            out.append({
                "kind": "lateral_ssh",
                "host_id": latest.host_id,
                "severity": "high",
                "summary": f"SSH/SCP burst across {len(hosts_with_ssh)} host(s) in fleet",
                "detail": f"Hosts: {', '.join(sorted(hosts_with_ssh)[:5])}",
                "event_ids": [e.id for h in hosts_with_ssh[:3] for e in ssh_by_host[h][-1:]],
            })

    # Re-check lateral within time window on single timeline
    ssh_events = [e for evs in ssh_by_host.values() for e in evs]
    if len(ssh_events) >= 4:
        t0 = ssh_events[-1].timestamp
        burst = [e for e in ssh_events if t0 - e.timestamp <= window]
        distinct_hosts = {e.host_id for e in burst}
        if len(distinct_hosts) >= 2 and not any(f["kind"] == "lateral_ssh" for f in out):
            out.append({
                "kind": "lateral_ssh",
                "host_id": ssh_events[-1].host_id,
                "severity": "high",
                "summary": f"Lateral movement — {len(burst)} SSH/SCP events across fleet",
                "detail": ssh_events[-1].summary,
                "event_ids": [e.id for e in burst[-5:]],
            })

    return out


def _dns_tunnel_label(query: str) -> bool:
    labels = query.lower().strip().rstrip(".").split(".")
    if not labels:
        return False
    longest = max(labels, key=len)
    if len(longest) < 24:
        return False
    entropy = len(set(longest)) / max(len(longest), 1)
    return entropy > 0.55 or bool(re.search(r"[a-z0-9]{20,}", longest))


def correlations_to_anomalies(findings: list[dict]) -> list[dict]:
    """Promote correlation findings into anomaly feed shape."""
    return [
        {
            "id": f"corr-{f['kind']}-{f['host_id']}",
            "host_id": f["host_id"],
            "severity": f["severity"],
            "kind": f["kind"],
            "summary": f["summary"],
            "detail": f.get("detail", ""),
        }
        for f in findings
    ]
