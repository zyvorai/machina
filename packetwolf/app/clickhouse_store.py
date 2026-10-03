# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

"""ClickHouse hot storage for security events."""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

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

CLICKHOUSE_URL = os.environ.get("CLICKHOUSE_URL", "").strip()


def enabled() -> bool:
    return bool(CLICKHOUSE_URL)


def ping() -> bool:
    client = _client()
    if not client:
        return False
    try:
        client.command("SELECT 1")
        return True
    except Exception:
        return False


def _client():
    if not CLICKHOUSE_URL:
        return None
    try:
        import clickhouse_connect
    except ImportError:
        return None
    parsed = urlparse(CLICKHOUSE_URL)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 8123
    secure = parsed.scheme == "https"
    return clickhouse_connect.get_client(
        host=host,
        port=port,
        secure=secure,
        database="packetwolf",
    )


def insert_event(event: SecurityEvent) -> None:
    client = _client()
    if not client:
        return
    row = _event_to_row(event)
    try:
        client.insert(
            "security_events",
            [row],
            column_names=list(row.keys()),
        )
    except Exception:
        pass


def query_events(
    host_id: str | None = None,
    kind: EventKind | None = None,
    hours: int = 24,
    limit: int = 100,
) -> list[SecurityEvent]:
    client = _client()
    if not client:
        return []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    clauses = ["timestamp >= {cutoff:DateTime64(3)}"]
    params: dict[str, Any] = {"cutoff": cutoff, "limit": limit}
    if host_id:
        clauses.append("host_id = {host_id:String}")
        params["host_id"] = host_id
    if kind:
        clauses.append("kind = {kind:String}")
        params["kind"] = kind.value
    where = " AND ".join(clauses)
    sql = f"""
        SELECT
            id, host_id, timestamp, kind, severity, verdict,
            process_pid, process_ppid, process_user, process_binary, process_args,
            network_src, network_dst, network_port, network_protocol,
            dns_query, file_path, file_action,
            k8s_namespace, k8s_pod, k8s_container, summary, raw_tetragon
        FROM security_events
        WHERE {where}
        ORDER BY timestamp DESC
        LIMIT {{limit:UInt32}}
    """
    try:
        result = client.query(sql, parameters=params)
        return [_row_to_event(dict(zip(result.column_names, row))) for row in result.result_rows]
    except Exception:
        return []


def _event_to_row(event: SecurityEvent) -> dict[str, Any]:
    raw = event.raw_tetragon
    return {
        "id": event.id,
        "host_id": event.host_id,
        "timestamp": event.timestamp,
        "kind": event.kind.value,
        "severity": event.severity.value,
        "verdict": event.verdict,
        "process_pid": event.process.pid,
        "process_ppid": event.process.ppid,
        "process_user": event.process.user,
        "process_binary": event.process.binary,
        "process_args": event.process.args,
        "network_src": event.network.src_ip,
        "network_dst": event.network.dst_ip,
        "network_port": event.network.port,
        "network_protocol": event.network.protocol,
        "dns_query": event.dns.query,
        "file_path": event.file.path,
        "file_action": event.file.action,
        "k8s_namespace": event.k8s.namespace,
        "k8s_pod": event.k8s.pod,
        "k8s_container": event.k8s.container,
        "summary": event.summary,
        "raw_tetragon": json.dumps(raw) if raw else "",
    }


def _row_to_event(row: dict[str, Any]) -> SecurityEvent:
    raw_text = row.get("raw_tetragon") or ""
    raw: dict[str, Any] = {}
    if raw_text:
        try:
            raw = json.loads(raw_text)
        except json.JSONDecodeError:
            raw = {}
    ts = row.get("timestamp")
    if isinstance(ts, datetime) and ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return SecurityEvent(
        id=str(row.get("id", "")),
        host_id=str(row.get("host_id", "")),
        timestamp=ts or datetime.now(timezone.utc),
        kind=EventKind(str(row.get("kind", "security"))),
        severity=Severity(str(row.get("severity", "info"))),
        verdict=str(row.get("verdict", "observed")),
        process=ProcessInfo(
            pid=int(row.get("process_pid") or 0),
            ppid=int(row.get("process_ppid") or 0),
            user=str(row.get("process_user") or ""),
            binary=str(row.get("process_binary") or ""),
            args=str(row.get("process_args") or ""),
        ),
        network=NetworkInfo(
            src_ip=str(row.get("network_src") or ""),
            dst_ip=str(row.get("network_dst") or ""),
            port=int(row.get("network_port") or 0),
            protocol=str(row.get("network_protocol") or "tcp"),
        ),
        dns=DnsInfo(query=str(row.get("dns_query") or "")),
        file=FileInfo(path=str(row.get("file_path") or ""), action=str(row.get("file_action") or "")),
        k8s=K8sInfo(
            namespace=str(row.get("k8s_namespace") or ""),
            pod=str(row.get("k8s_pod") or ""),
            container=str(row.get("k8s_container") or ""),
        ),
        summary=str(row.get("summary") or ""),
        raw_tetragon=raw,
    )
