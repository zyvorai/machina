# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

"""In-memory event store with demo seed data (ClickHouse optional)."""

from __future__ import annotations

import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from .models import DnsInfo, EventKind, FileInfo, K8sInfo, NetworkInfo, ProcessInfo, SecurityEvent, Severity
from . import clickhouse_store
from . import correlator
from . import enforcer
from . import search_index

_events: list[SecurityEvent] = []
_correlations: list[dict] = []
_sensors: dict[str, dict[str, Any]] = {}
_policies: dict[str, enforcer.EnforcementPolicy] = {}
_enforcement_stats: dict[str, int] = {"blocked_total": 0, "by_policy": {}}
_pending_tetragon: dict[str, dict[str, Any]] = {}
_removed_policies: dict[str, list[str]] = defaultdict(list)
_process_edges: dict[str, list[tuple[int, int, str]]] = defaultdict(list)
_seeded = False


def _seed_demo() -> None:
    global _seeded
    if _seeded:
        return
    if os.environ.get("PACKETWOLF_DEMO", "1") == "0":
        _seeded = True
        for pol in enforcer.default_policies():
            _policies[pol.id] = pol
        return
    _seeded = True
    now = datetime.now(timezone.utc)
    hosts = ["h1", "h2", "demo-host"]
    for hid in hosts:
        _sensors[hid] = {
            "host_id": hid,
            "status": "healthy",
            "tetragon_version": "1.0.0",
            "last_event_at": now.isoformat(),
        }
    for pol in enforcer.default_policies():
        _policies[pol.id] = pol
    demo: list[SecurityEvent] = [
        SecurityEvent(
            host_id="h1",
            timestamp=now - timedelta(minutes=30),
            kind=EventKind.PROCESS_EXEC,
            severity=Severity.INFO,
            process=ProcessInfo(pid=1000, ppid=1, user="root", binary="/usr/sbin/sshd", args="-D"),
            summary="sshd started",
        ),
        SecurityEvent(
            host_id="h1",
            timestamp=now - timedelta(minutes=29),
            kind=EventKind.PROCESS_EXEC,
            severity=Severity.INFO,
            process=ProcessInfo(pid=1234, ppid=1000, user="sus", binary="/bin/bash", args="-l"),
            summary="bash started",
        ),
        SecurityEvent(
            host_id="h1",
            timestamp=now - timedelta(minutes=28),
            kind=EventKind.PROCESS_EXEC,
            severity=Severity.INFO,
            process=ProcessInfo(pid=1235, ppid=1234, user="sus", binary="/usr/bin/kubectl", args="get pods"),
            summary="kubectl get pods",
        ),
        SecurityEvent(
            host_id="h1",
            timestamp=now - timedelta(minutes=27),
            kind=EventKind.PROCESS_EXEC,
            severity=Severity.INFO,
            process=ProcessInfo(pid=1236, ppid=1235, user="sus", binary="/usr/bin/curl", args="https://api.github.com"),
            summary="curl https://api.github.com",
        ),
        SecurityEvent(
            host_id="h1",
            timestamp=now - timedelta(minutes=25),
            kind=EventKind.NETWORK_CONNECT,
            severity=Severity.INFO,
            process=ProcessInfo(pid=1236, binary="/usr/bin/curl", user="sus"),
            network=NetworkInfo(dst_ip="140.82.121.3", port=443, protocol="tcp"),
            verdict="allowed",
            summary="curl → github.com:443",
        ),
        SecurityEvent(
            host_id="h1",
            timestamp=now - timedelta(minutes=20),
            kind=EventKind.DNS_QUERY,
            severity=Severity.INFO,
            process=ProcessInfo(pid=1236, binary="/usr/bin/curl", user="sus"),
            dns=DnsInfo(query="api.github.com"),
            summary="curl → api.github.com",
        ),
        SecurityEvent(
            host_id="h1",
            timestamp=now - timedelta(minutes=15),
            kind=EventKind.PRIVILEGE_ESC,
            severity=Severity.HIGH,
            process=ProcessInfo(pid=1300, ppid=1234, user="sus", binary="/usr/bin/sudo", args="-s"),
            summary="User sus executed sudo",
        ),
        SecurityEvent(
            host_id="h1",
            timestamp=now - timedelta(minutes=10),
            kind=EventKind.FILE_WRITE,
            severity=Severity.HIGH,
            process=ProcessInfo(pid=1301, user="root", binary="/usr/bin/vim"),
            file=FileInfo(path="/etc/sudoers", action="write"),
            summary="Sensitive file modified: /etc/sudoers",
        ),
        SecurityEvent(
            host_id="h1",
            timestamp=now - timedelta(minutes=4),
            kind=EventKind.PROCESS_EXEC,
            severity=Severity.MEDIUM,
            process=ProcessInfo(pid=1500, ppid=1, user="65532", binary="/app/server", args="--port=8080"),
            k8s=K8sInfo(namespace="zeus", pod="api-server-7f8c9", container="api", deployment="api-server"),
            summary="api-server container exec /app/server",
        ),
        SecurityEvent(
            host_id="h1",
            timestamp=now - timedelta(minutes=3),
            kind=EventKind.NETWORK_CONNECT,
            severity=Severity.INFO,
            process=ProcessInfo(pid=1500, binary="/app/server", user="65532"),
            network=NetworkInfo(dst_ip="10.96.0.12", port=5432, protocol="tcp"),
            k8s=K8sInfo(namespace="zeus", pod="api-server-7f8c9", container="api", deployment="api-server"),
            summary="api-server → postgres.zeus.svc:5432",
        ),
        SecurityEvent(
            host_id="h1",
            timestamp=now - timedelta(minutes=2),
            kind=EventKind.PROCESS_EXEC,
            severity=Severity.INFO,
            process=ProcessInfo(pid=1600, user="65534", binary="/coredns", args="-conf /etc/coredns/Corefile"),
            k8s=K8sInfo(namespace="kube-system", pod="coredns-abc12", container="coredns", deployment="coredns"),
            summary="coredns container started",
        ),
        SecurityEvent(
            host_id="h1",
            timestamp=now - timedelta(minutes=1),
            kind=EventKind.DNS_QUERY,
            severity=Severity.INFO,
            process=ProcessInfo(pid=1500, binary="/app/server", user="65532"),
            dns=DnsInfo(query="redis.zeus.svc.cluster.local"),
            k8s=K8sInfo(namespace="zeus", pod="api-server-7f8c9", container="api", deployment="api-server"),
            summary="api-server DNS redis.zeus.svc.cluster.local",
        ),
        SecurityEvent(
            host_id="h1",
            timestamp=now - timedelta(seconds=45),
            kind=EventKind.SECURITY,
            severity=Severity.HIGH,
            process=ProcessInfo(pid=1700, user="65532", binary="/bin/sh", args="-c curl evil.example"),
            k8s=K8sInfo(namespace="zeus", pod="worker-xyz99", container="worker", deployment="batch-worker"),
            summary="Suspicious shell in worker pod",
        ),
        SecurityEvent(
            host_id="h1",
            timestamp=now - timedelta(minutes=5),
            kind=EventKind.SECURITY,
            severity=Severity.CRITICAL,
            process=ProcessInfo(pid=1400, user="root", binary="/usr/bin/nc", args="-l 4444"),
            summary="Possible reverse shell on port 4444",
            verdict="blocked",
        ),
        SecurityEvent(
            host_id="h2",
            timestamp=now - timedelta(minutes=8),
            kind=EventKind.DNS_QUERY,
            severity=Severity.HIGH,
            process=ProcessInfo(pid=2001, binary="/usr/bin/curl", user="www-data"),
            dns=DnsInfo(query="suspicious-domain.xyz"),
            summary="curl → suspicious-domain.xyz",
        ),
    ]
    for ev in demo:
        ingest(ev)
    _process_edges["h1"] = [(1, 1000, "/usr/sbin/sshd"), (1000, 1234, "/bin/bash"), (1234, 1235, "/usr/bin/kubectl"), (1235, 1236, "/usr/bin/curl")]


def ingest(event: SecurityEvent) -> SecurityEvent:
    _seed_demo()
    doc = event.model_dump(mode="json")
    policy_id = enforcer.evaluate_event(doc, list(_policies.values()), event.host_id)
    if policy_id:
        event.verdict = "blocked"
        event.severity = Severity.HIGH
        if not event.summary.endswith("(enforced)"):
            event.summary = f"{event.summary} (enforced)"
        _enforcement_stats["blocked_total"] = _enforcement_stats.get("blocked_total", 0) + 1
        by_pol = _enforcement_stats.setdefault("by_policy", {})
        by_pol[policy_id] = by_pol.get(policy_id, 0) + 1
    _events.append(event)
    if event.process.ppid and event.process.pid:
        _process_edges[event.host_id].append(
            (event.process.ppid, event.process.pid, event.process.binary)
        )
    if event.host_id not in _sensors:
        _sensors[event.host_id] = {"host_id": event.host_id, "status": "healthy", "tetragon_version": "1.0.0"}
    _sensors[event.host_id]["last_event_at"] = event.timestamp.isoformat()
    doc = event.model_dump(mode="json")
    search_index.index_event(doc)
    clickhouse_store.insert_event(event)
    _recompute_correlations()
    return event


def _recompute_correlations() -> None:
    global _correlations
    recent = list_events(hours=48, limit=500)
    _correlations = correlator.correlate_events(recent)


def ingest_raw(host_id: str, lines: list[dict[str, Any]]) -> int:
    from .normalizer import normalize_batch

    events = normalize_batch(host_id, lines)
    for ev in events:
        ingest(ev)
    return len(events)


def list_events(
    host_id: str | None = None,
    kind: EventKind | None = None,
    hours: int = 24,
    limit: int = 100,
) -> list[SecurityEvent]:
    _seed_demo()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    memory = [e for e in _events if e.timestamp >= cutoff]
    if host_id:
        memory = [e for e in memory if e.host_id == host_id]
    if kind:
        memory = [e for e in memory if e.kind == kind]
    ch_events = clickhouse_store.query_events(host_id=host_id, kind=kind, hours=hours, limit=limit)
    merged: dict[str, SecurityEvent] = {e.id: e for e in ch_events}
    for e in memory:
        merged[e.id] = e
    out = list(merged.values())
    out.sort(key=lambda e: e.timestamp, reverse=True)
    return out[:limit]


def host_summary(host_id: str) -> dict[str, Any]:
    _seed_demo()
    events = list_events(host_id=host_id, limit=500)
    critical = sum(1 for e in events if e.severity == Severity.CRITICAL)
    high = sum(1 for e in events if e.severity == Severity.HIGH)
    threat = max(0, min(100, 100 - critical * 25 - high * 10))
    sensor = _sensors.get(host_id, {"host_id": host_id, "status": "not_installed"})
    return {
        "host_id": host_id,
        "threat_score": threat,
        "sensor": sensor,
        "event_counts": {
            "total": len(events),
            "critical": critical,
            "high": high,
        },
    }


def fleet_threat_summary() -> dict[str, Any]:
    _seed_demo()
    hosts = sorted(set(e.host_id for e in _events) | set(_sensors.keys()))
    summaries = [host_summary(h) for h in hosts]
    avg = sum(s["threat_score"] for s in summaries) / max(len(summaries), 1)
    critical_events = [
        e.model_dump(mode="json")
        for e in _events
        if e.severity in (Severity.CRITICAL, Severity.HIGH)
    ][:25]
    corr = correlator.correlations_to_anomalies(list_correlations())
    for c in corr:
        if c.get("severity") in ("critical", "high"):
            critical_events.insert(0, c)
    return {
        "fleet_threat_score": round(avg, 1),
        "hosts": summaries,
        "critical_events": critical_events[:25],
        "sensors_healthy": sum(1 for s in _sensors.values() if s.get("status") == "healthy"),
        "sensors_total": len(_sensors),
    }


def process_graph(host_id: str, pid: int | None = None) -> dict[str, Any]:
    _seed_demo()
    edges = _process_edges.get(host_id, [])
    nodes: dict[int, dict[str, Any]] = {}
    for ppid, cpid, binary in edges:
        nodes.setdefault(ppid, {"pid": ppid, "binary": ""})
        nodes[cpid] = {"pid": cpid, "binary": binary, "ppid": ppid}
    if pid:
        ancestry = []
        cur = pid
        for _ in range(20):
            found = next((n for n in nodes.values() if n["pid"] == cur), None)
            if not found:
                break
            ancestry.append(found)
            cur = found.get("ppid")
            if not cur:
                break
        children = [{"pid": cp, "binary": b} for pp, cp, b in edges if pp == pid]
        return {"host_id": host_id, "pid": pid, "ancestry": ancestry, "children": children}
    return {
        "host_id": host_id,
        "nodes": list(nodes.values()),
        "edges": [{"from": pp, "to": cp, "binary": b} for pp, cp, b in edges],
    }


def container_hierarchy(host_id: str) -> dict[str, Any]:
    _seed_demo()
    severity_rank = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
    namespaces: dict[str, dict[str, Any]] = {}
    for e in _events:
        if e.host_id != host_id:
            continue
        k = e.k8s
        if not (k.namespace or k.pod or k.container):
            continue
        ns_name = k.namespace or "default"
        pod_name = k.pod or "unknown"
        container_name = k.container or "main"
        ns = namespaces.setdefault(
            ns_name,
            {"namespace": ns_name, "pods": {}, "event_count": 0},
        )
        ns["event_count"] += 1
        pod = ns["pods"].setdefault(
            pod_name,
            {
                "pod": pod_name,
                "deployment": k.deployment,
                "containers": {},
                "event_count": 0,
            },
        )
        pod["event_count"] += 1
        if k.deployment and not pod.get("deployment"):
            pod["deployment"] = k.deployment
        container = pod["containers"].setdefault(
            container_name,
            {
                "container": container_name,
                "event_count": 0,
                "processes": set(),
                "max_severity": "info",
            },
        )
        container["event_count"] += 1
        if e.process.binary:
            container["processes"].add(e.process.binary)
        sev = e.severity.value
        if severity_rank.get(sev, 0) > severity_rank.get(container["max_severity"], 0):
            container["max_severity"] = sev
    namespaces_out = []
    for ns in namespaces.values():
        pods_out = []
        for pod in ns["pods"].values():
            containers_out = []
            for c in pod["containers"].values():
                containers_out.append({**c, "processes": sorted(c["processes"])})
            pods_out.append({**pod, "containers": containers_out})
        namespaces_out.append({**ns, "pods": pods_out})
    return {
        "host_id": host_id,
        "namespaces": sorted(namespaces_out, key=lambda n: n["namespace"]),
        "summary": f"{len(namespaces_out)} namespace(s) with pod/container metadata from Tetragon",
    }


def open_ports(host_id: str) -> list[dict[str, Any]]:
    _seed_demo()
    ports = [
        {"port": 22, "protocol": "tcp", "service": "SSH", "process": "sshd", "user": "root", "bind": "0.0.0.0"},
        {"port": 443, "protocol": "tcp", "service": "HTTPS", "process": "nginx", "user": "www-data", "bind": "0.0.0.0"},
        {"port": 5432, "protocol": "tcp", "service": "PostgreSQL", "process": "postgres", "user": "postgres", "bind": "127.0.0.1"},
        {"port": 6443, "protocol": "tcp", "service": "Kubernetes", "process": "kube-apiserver", "user": "root", "bind": "0.0.0.0"},
    ]
    return [{"host_id": host_id, **p} for p in ports]


def search(query: str, host_id: str | None = None, limit: int = 50) -> dict[str, Any]:
    _seed_demo()
    os_hits = search_index.search(query, host_id, limit) if search_index.configured() else []
    mem_hits = _memory_search(query, host_id, limit)
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for hit in os_hits:
        doc_id = str(hit.get("id", ""))
        if doc_id and doc_id in seen:
            continue
        if doc_id:
            seen.add(doc_id)
        merged.append(hit)
    for hit in mem_hits:
        doc_id = str(hit.get("id", ""))
        if doc_id and doc_id in seen:
            continue
        if doc_id:
            seen.add(doc_id)
        hit = dict(hit)
        hit["search_source"] = hit.get("search_source", "memory")
        merged.append(hit)
        if len(merged) >= limit:
            break
    os_count = sum(1 for h in merged if h.get("search_source") == "opensearch")
    mem_count = len(merged) - os_count
    if os_count and mem_count:
        backend = "merged"
    elif os_count:
        backend = "opensearch"
    else:
        backend = "memory"
    return {
        "results": merged[:limit],
        "hit_count": len(merged[:limit]),
        "backend": backend,
        "sources": {"opensearch": os_count, "memory": mem_count},
    }


def _memory_search(query: str, host_id: str | None, limit: int) -> list[dict[str, Any]]:
    q = query.lower()
    out: list[dict[str, Any]] = []
    for e in _events:
        if host_id and e.host_id != host_id:
            continue
        blob = f"{e.summary} {e.process.binary} {e.process.args} {e.dns.query} {e.file.path}".lower()
        if q in blob or not q.strip() or q == "*":
            doc = e.model_dump(mode="json")
            doc["search_source"] = "memory"
            out.append(doc)
        if len(out) >= limit:
            break
    return out


def list_correlations() -> list[dict]:
    _seed_demo()
    _recompute_correlations()
    return _correlations


def fleet_timeline(hours: int = 24, limit: int = 200) -> list[dict]:
    events = [e.model_dump(mode="json") for e in list_events(hours=hours, limit=limit)]
    corrs = list_correlations()
    merged = events + [
        {
            "id": c.get("id", f"corr-{i}"),
            "host_id": c.get("host_id"),
            "timestamp": events[0]["timestamp"] if events else None,
            "kind": "correlation",
            "severity": c.get("severity", "medium"),
            "summary": c.get("summary"),
            "source": "correlator",
        }
        for i, c in enumerate(corrs)
    ]
    return merged[:limit]


def register_sensor(host_id: str, tetragon_version: str = "1.0.0") -> dict[str, Any]:
    _sensors[host_id] = {
        "host_id": host_id,
        "status": "healthy",
        "tetragon_version": tetragon_version,
        "last_event_at": datetime.now(timezone.utc).isoformat(),
    }
    return _sensors[host_id]


def list_sensors() -> list[dict[str, Any]]:
    _seed_demo()
    return list(_sensors.values())


def asset_inventory() -> dict[str, Any]:
    _seed_demo()
    hosts: dict[str, Any] = {}
    for e in _events:
        h = hosts.setdefault(e.host_id, {"host_id": e.host_id, "processes": set(), "connections": []})
        if e.process.binary:
            h["processes"].add(e.process.binary)
        if e.kind == EventKind.NETWORK_CONNECT and e.network.dst_ip:
            h["connections"].append(
                {"from": e.process.binary, "to": f"{e.network.dst_ip}:{e.network.port}"}
            )
    return {
        "hosts": [
            {**v, "processes": sorted(v["processes"])} for v in hosts.values()
        ]
    }


def list_enforcement_policies() -> list[dict[str, Any]]:
    _seed_demo()
    return [p.model_dump(mode="json") for p in _policies.values()]


def get_enforcement_policy(policy_id: str) -> dict[str, Any] | None:
    _seed_demo()
    pol = _policies.get(policy_id)
    return pol.model_dump(mode="json") if pol else None


def create_enforcement_policy(req: enforcer.CreatePolicyRequest) -> dict[str, Any]:
    _seed_demo()
    pol = enforcer.EnforcementPolicy(
        name=req.name,
        kind=req.kind,
        match=req.match,
        enabled=req.enabled,
        scope=req.scope,
        host_ids=req.host_ids,
        description=req.description,
    )
    _policies[pol.id] = pol
    return pol.model_dump(mode="json")


def _queue_policy_removal(host_ids: list[str], policy_id: str) -> None:
    name = enforcer.tetragon_policy_name(policy_id)
    for hid in host_ids:
        if name not in _removed_policies[hid]:
            _removed_policies[hid].append(name)


def patch_enforcement_policy(policy_id: str, req: enforcer.PatchPolicyRequest) -> dict[str, Any]:
    _seed_demo()
    pol = _policies.get(policy_id)
    if not pol:
        return {"ok": False, "error": "policy not found"}
    was_enabled = pol.enabled
    if req.enabled is not None:
        pol.enabled = req.enabled
    if req.match is not None:
        pol.match = req.match
    if req.description is not None:
        pol.description = req.description
    if req.enabled is False and was_enabled:
        _queue_policy_removal(pol.applied_hosts, policy_id)
    return {
        "ok": True,
        "policy": pol.model_dump(mode="json"),
        "tetragon_policy": enforcer.to_tetragon_policy(pol),
        "sync_hosts": pol.applied_hosts if pol.applied_hosts else [],
    }


def delete_enforcement_policy(policy_id: str) -> dict[str, Any]:
    _seed_demo()
    pol = _policies.pop(policy_id, None)
    if not pol:
        return {"ok": False, "error": "policy not found"}
    tetragon_name = enforcer.tetragon_policy_name(policy_id)
    _queue_policy_removal(pol.applied_hosts, policy_id)
    return {
        "ok": True,
        "policy_id": policy_id,
        "tetragon_policy": tetragon_name,
        "removed_from_hosts": pol.applied_hosts,
    }


def get_enforcement_policy_tetragon(policy_id: str) -> dict[str, Any]:
    _seed_demo()
    pol = _policies.get(policy_id)
    if not pol:
        return {"ok": False, "error": "policy not found"}
    tetragon = enforcer.to_tetragon_policy(pol)
    return {
        "ok": True,
        "policy_id": policy_id,
        "tetragon_policy": tetragon,
        "tetragon_policy_name": enforcer.tetragon_policy_name(policy_id),
    }


def apply_enforcement_policy(policy_id: str, host_ids: list[str]) -> dict[str, Any]:
    _seed_demo()
    pol = _policies.get(policy_id)
    if not pol:
        return {"ok": False, "error": "policy not found"}
    applied = list(dict.fromkeys(pol.applied_hosts + host_ids))
    pol.applied_hosts = applied
    tetragon = enforcer.to_tetragon_policy(pol)
    return {
        "ok": True,
        "policy_id": policy_id,
        "applied_hosts": applied,
        "tetragon_policy": tetragon,
        "summary": f"Applied {pol.name} to {len(host_ids)} host(s) — agent will push TracingPolicy",
    }


def enforcement_status() -> dict[str, Any]:
    _seed_demo()
    enabled = sum(1 for p in _policies.values() if p.enabled)
    applied_hosts = sorted({h for p in _policies.values() for h in p.applied_hosts})
    blocked_events = sum(1 for e in _events if e.verdict == "blocked")
    return {
        "mode": "enforce",
        "policies_total": len(_policies),
        "policies_enabled": enabled,
        "applied_hosts": applied_hosts,
        "blocked_events": blocked_events,
        "blocked_total": _enforcement_stats.get("blocked_total", blocked_events),
        "by_policy": _enforcement_stats.get("by_policy", {}),
        "summary": f"{enabled} active policy(ies) · {blocked_events} blocked event(s) in store",
    }


def host_enforcement(host_id: str) -> dict[str, Any]:
    _seed_demo()
    active = [
        p.model_dump(mode="json")
        for p in _policies.values()
        if p.enabled and (not p.applied_hosts or host_id in p.applied_hosts)
    ]
    blocked = sum(1 for e in _events if e.host_id == host_id and e.verdict == "blocked")
    return {
        "host_id": host_id,
        "mode": "enforce" if active else "observe",
        "policies": active,
        "blocked_events": blocked,
    }


def storage_status() -> dict[str, Any]:
    os_stats = search_index.index_stats()
    return {
        "clickhouse": {
            "configured": clickhouse_store.enabled(),
            "reachable": clickhouse_store.ping(),
        },
        "opensearch": os_stats,
        "demo_mode": os.environ.get("PACKETWOLF_DEMO", "1") != "0",
    }


def fabric_health() -> dict[str, Any]:
    _seed_demo()
    storage = storage_status()
    sensors = list_sensors()
    healthy = sum(1 for s in sensors if s.get("status") == "healthy")
    issues: list[dict[str, Any]] = []
    if storage["opensearch"].get("configured") and not storage["opensearch"].get("reachable"):
        issues.append(
            {
                "severity": "warning",
                "kind": "opensearch_unreachable",
                "summary": "OpenSearch configured but unreachable — hunt queries fall back to in-memory index",
            }
        )
    if storage["clickhouse"].get("configured") and not storage["clickhouse"].get("reachable"):
        issues.append(
            {
                "severity": "warning",
                "kind": "clickhouse_unreachable",
                "summary": "ClickHouse configured but unreachable — using in-memory hot cache",
            }
        )
    stale_cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
    for s in sensors:
        last = s.get("last_event_at")
        if not last:
            continue
        try:
            ts = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
        except ValueError:
            continue
        if ts < stale_cutoff:
            issues.append(
                {
                    "severity": "medium",
                    "kind": "sensor_stale",
                    "host_id": s.get("host_id"),
                    "summary": f"Sensor {s.get('host_id')} has no events in 30+ minutes",
                }
            )
    if not sensors:
        issues.append(
            {
                "severity": "info",
                "kind": "no_sensors",
                "summary": "No Tetragon sensors enrolled — install sensors on hosts or K8s clusters",
            }
        )
    status = "healthy"
    if any(i.get("severity") in ("critical", "high") for i in issues):
        status = "degraded"
    elif issues:
        status = "degraded" if len(issues) > 1 else "healthy"
    if not storage["opensearch"].get("configured") and not storage["clickhouse"].get("configured"):
        status = "degraded" if sensors else "offline"
    return {
        "status": status,
        "sensors_total": len(sensors),
        "sensors_healthy": healthy,
        "storage": storage,
        "hunt_index": storage["opensearch"],
        "issues": issues,
        "summary": f"{len(sensors)} sensor(s) · {storage['opensearch'].get('document_count', 0)} OpenSearch doc(s)",
    }


def queue_tetragon_install(host_id: str) -> dict[str, Any]:
    _seed_demo()
    register_sensor(host_id)
    bundle = {
        "host_id": host_id,
        "status": "queued",
        "install_unit": "tetragon.service",
        "export_url": os.environ.get("PACKETWOLF_INGEST_URL", "http://127.0.0.1:9091/api/v1/ingest"),
    }
    _pending_tetragon[host_id] = bundle
    return bundle


def agent_bundle(host_id: str) -> dict[str, Any]:
    _seed_demo()
    tracing = [
        enforcer.to_tetragon_policy(p)
        for p in _policies.values()
        if p.enabled and (not p.applied_hosts or host_id in p.applied_hosts)
    ]
    removed = list(_removed_policies.get(host_id, []))
    return {
        "host_id": host_id,
        "tetragon_install": _pending_tetragon.get(host_id),
        "tracing_policies": tracing,
        "removed_policies": removed,
        "policy_count": len(tracing),
        "sensor": _sensors.get(host_id),
    }


def ack_agent_bundle(host_id: str) -> dict[str, Any]:
    removed_install = _pending_tetragon.pop(host_id, None)
    removed_policies = _removed_policies.pop(host_id, [])
    return {
        "host_id": host_id,
        "acknowledged": removed_install is not None or bool(removed_policies),
        "removed_policies_cleared": removed_policies,
    }

