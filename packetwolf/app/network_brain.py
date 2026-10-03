# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

from __future__ import annotations

import subprocess
from collections import Counter, defaultdict
from typing import Any

from . import store
from .models import EventKind


def _workloads_from_events() -> list[dict[str, Any]]:
    store._seed_demo()
    seen: dict[str, dict[str, Any]] = {}
    for e in store.list_events(hours=168, limit=5000):
        k8s = e.k8s
        if not k8s.pod and not k8s.namespace:
            continue
        key = f"{k8s.namespace}/{k8s.pod or e.process.binary or 'unknown'}"
        row = seen.setdefault(
            key,
            {
                "namespace": k8s.namespace or "default",
                "name": k8s.pod or e.process.binary or "unknown",
                "kind": k8s.kind or "Pod",
                "host_id": e.host_id,
                "connections_in": 0,
                "connections_out": 0,
                "blocked_flows": 0,
                "risk": "low",
            },
        )
        if e.kind == EventKind.NETWORK_CONNECT:
            row["connections_out"] += 1
            if e.severity.value in ("high", "critical"):
                row["blocked_flows"] += 1
                row["risk"] = "high"
            elif e.severity.value == "medium" and row["risk"] != "high":
                row["risk"] = "medium"
    return list(seen.values())


def _flow_counters() -> tuple[int, int]:
    events = store.list_events(limit=500)
    dropped = sum(1 for e in events if e.verdict == "blocked")
    forwarded = len(events) - dropped
    return forwarded, dropped


def network_overview() -> dict[str, Any]:
    workloads = _workloads_from_events()
    forwarded, dropped = _flow_counters()
    connections = sum(w.get("connections_out", 0) for w in workloads)
    blocked = sum(w.get("blocked_flows", 0) for w in workloads)
    total = max(1, forwarded + dropped)
    return {
        "live_connections": connections,
        "services": len({f"{w['namespace']}/{w['name']}" for w in workloads}),
        "workloads": len(workloads),
        "drop_rate": dropped / total,
        "forwarded": forwarded,
        "dropped": dropped,
        "blocked_edges": blocked,
    }


def network_service_map() -> dict[str, Any]:
    workloads = _workloads_from_events()
    nodes = [
        {
            "namespace": w["namespace"],
            "name": w["name"],
            "status": "warning" if w.get("blocked_flows") else "ok",
            "risk": w.get("risk", "low"),
            "connections_in": w.get("connections_in", 0),
            "connections_out": w.get("connections_out", 0),
            "blocked_flows": w.get("blocked_flows", 0),
        }
        for w in workloads
    ]
    edges: list[dict[str, Any]] = []
    edge_counts: Counter[tuple[str, str]] = Counter()
    for e in store.list_events(hours=24, limit=2000, kind=EventKind.NETWORK_CONNECT):
        src = e.k8s.pod or e.process.binary or e.host_id
        src_ns = e.k8s.namespace or "default"
        dst = e.network.dst_ip or "external"
        src_id = f"{src_ns}/{src}"
        dst_id = f"ext/{dst}"
        edge_counts[(src_id, dst_id)] += 1
    for i, ((src, dst), count) in enumerate(edge_counts.most_common(48)):
        edges.append(
            {
                "id": f"edge-{i}",
                "source": src,
                "target": dst,
                "health": "ok",
                "dropped_count": 0,
                "count": count,
            }
        )
    attack = [w["name"] for w in workloads if w.get("risk") == "high"][:5]
    top = [w["name"] for w in sorted(workloads, key=lambda w: w.get("connections_out", 0), reverse=True)[:5]]
    stats = {
        "services": len(nodes),
        "connections": len(edges),
        "blocked": sum(n.get("blocked_flows", 0) for n in nodes),
    }
    return {
        "nodes": nodes,
        "edges": edges,
        "meta": {"stats": stats},
        "stats": stats,
        "overlays": {"attack_path_workloads": attack, "top_talker_nodes": top},
    }


def network_workloads() -> dict[str, Any]:
    return {"workloads": _workloads_from_events()}


def network_timeline(limit: int = 40) -> dict[str, Any]:
    events = store.fleet_timeline(hours=24, limit=limit)
    return {"events": events}


def network_threats() -> dict[str, Any]:
    threats: list[dict[str, Any]] = []
    for c in store.list_correlations():
        threats.append(
            {
                "title": c.get("kind", "Correlation").replace("_", " ").title(),
                "severity": c.get("severity", "medium"),
                "summary": c.get("summary", ""),
                "host_id": c.get("host_id"),
                "suggested_kind": "deny_port",
                "suggested_match": "4444/tcp",
            }
        )
    return {"threats": threats}


def network_top_talkers(limit: int = 10) -> dict[str, Any]:
    counts: Counter[str] = Counter()
    for e in store.list_events(hours=24, limit=3000, kind=EventKind.NETWORK_CONNECT):
        label = e.k8s.pod or e.process.binary or e.host_id
        if e.k8s.namespace:
            label = f"{e.k8s.namespace}/{label}"
        counts[label] += 1
    rows = [{"name": name, "flows": n} for name, n in counts.most_common(limit)]
    return {"talkers": rows, "top_talkers": rows}


def k8s_nodes() -> dict[str, Any]:
    try:
        out = subprocess.run(
            ["kubectl", "get", "nodes", "-o", "json"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if out.returncode != 0 or not out.stdout.strip():
            return {"nodes": [], "source": "unavailable"}
        import json

        data = json.loads(out.stdout)
        nodes = []
        for item in data.get("items", []):
            meta = item.get("metadata", {})
            status = item.get("status", {})
            conds = status.get("conditions") or []
            ready = any(c.get("type") == "Ready" and c.get("status") == "True" for c in conds)
            nodes.append(
                {
                    "name": meta.get("name", ""),
                    "status": "Ready" if ready else "NotReady",
                    "pods_count": None,
                }
            )
        return {"nodes": nodes, "source": "kubectl"}
    except Exception:
        sensors = store.list_sensors()
        return {
            "nodes": [{"name": s.get("host_id", ""), "status": s.get("status", "unknown"), "pods_count": None} for s in sensors],
            "source": "sensors",
        }
