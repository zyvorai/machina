# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .models import CaptureRequest, IngestBatch, SearchRequest, SecurityEvent
from . import enforcer
from . import hunt
from . import network_brain
from . import store

app = FastAPI(title="PacketWolf Security Fabric", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    from . import search_index

    search_index.ensure_index()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "packetwolf", "storage": store.storage_status()}


@app.post("/api/v1/ingest/{host_id}")
def ingest_tetragon(host_id: str, body: IngestBatch) -> dict:
    count = store.ingest_raw(host_id, body.events)
    return {"ingested": count, "host_id": host_id}


@app.post("/api/v1/ingest/{host_id}/event")
def ingest_event(host_id: str, event: SecurityEvent) -> dict:
    event.host_id = host_id
    store.ingest(event)
    return {"ok": True, "id": event.id}


@app.get("/api/v1/hosts/{host_id}/summary")
def host_summary(host_id: str) -> dict:
    return store.host_summary(host_id)


@app.get("/api/v1/hosts/{host_id}/processes")
def host_processes(host_id: str, hours: int = Query(24), limit: int = Query(100)) -> dict:
    from .models import EventKind

    events = store.list_events(host_id=host_id, kind=EventKind.PROCESS_EXEC, hours=hours, limit=limit)
    return {"host_id": host_id, "processes": [e.model_dump(mode="json") for e in events]}


@app.get("/api/v1/hosts/{host_id}/connections")
def host_connections(host_id: str, hours: int = Query(24), limit: int = Query(100)) -> dict:
    from .models import EventKind

    events = store.list_events(host_id=host_id, kind=EventKind.NETWORK_CONNECT, hours=hours, limit=limit)
    return {"host_id": host_id, "connections": [e.model_dump(mode="json") for e in events]}


@app.get("/api/v1/hosts/{host_id}/dns")
def host_dns(host_id: str, hours: int = Query(24), limit: int = Query(100)) -> dict:
    from .models import EventKind

    events = store.list_events(host_id=host_id, kind=EventKind.DNS_QUERY, hours=hours, limit=limit)
    return {"host_id": host_id, "dns": [e.model_dump(mode="json") for e in events]}


@app.get("/api/v1/hosts/{host_id}/files")
def host_files(host_id: str, hours: int = Query(168), limit: int = Query(100)) -> dict:
    from .models import EventKind

    events = store.list_events(host_id=host_id, kind=EventKind.FILE_WRITE, hours=hours, limit=limit)
    return {"host_id": host_id, "files": [e.model_dump(mode="json") for e in events]}


@app.get("/api/v1/hosts/{host_id}/ports")
def host_ports(host_id: str) -> dict:
    return {"host_id": host_id, "ports": store.open_ports(host_id)}


@app.get("/api/v1/hosts/{host_id}/containers")
def host_containers(host_id: str) -> dict:
    return store.container_hierarchy(host_id)


@app.get("/api/v1/hosts/{host_id}/timeline")
def host_timeline(host_id: str, hours: int = Query(24), limit: int = Query(200)) -> dict:
    events = store.list_events(host_id=host_id, hours=hours, limit=limit)
    return {"host_id": host_id, "events": [e.model_dump(mode="json") for e in events]}


@app.get("/api/v1/hosts/{host_id}/process-graph")
def host_process_graph(host_id: str, pid: int | None = Query(None)) -> dict:
    return store.process_graph(host_id, pid)


@app.get("/api/v1/flows")
def flows(host_id: str | None = Query(None), limit: int = Query(50), verdict: str | None = Query(None)) -> dict:
    events = store.list_events(host_id=host_id, limit=limit)
    flows_out = []
    for e in events:
        if e.kind.value not in ("network_connect", "security"):
            continue
        v = e.verdict
        if verdict and verdict.upper() not in v.upper():
            if verdict.upper() == "DROPPED" and v != "blocked":
                continue
        flows_out.append(
            {
                "host_id": e.host_id,
                "verdict": e.verdict.upper() if e.verdict == "blocked" else "FORWARDED",
                "process": e.process.binary,
                "destination_ip": e.network.dst_ip,
                "destination_port": e.network.port,
                "summary": e.summary,
                "timestamp": e.timestamp.isoformat(),
            }
        )
    return {"flows": flows_out[:limit]}


@app.get("/api/v1/flows/stats")
def flow_stats(host_id: str | None = Query(None)) -> dict:
    events = store.list_events(host_id=host_id, limit=500)
    dropped = sum(1 for e in events if e.verdict == "blocked")
    forwarded = len(events) - dropped
    return {"dropped": dropped, "forwarded": forwarded, "dropped_count": dropped, "allowed": forwarded}


@app.get("/api/v1/anomalies")
def anomalies(limit: int = Query(25)) -> dict:
    from .models import Severity

    events = store.list_events(limit=500)
    anomalies_out = [
        {
            "id": e.id,
            "host_id": e.host_id,
            "severity": e.severity.value,
            "kind": e.kind.value,
            "summary": e.summary,
            "timestamp": e.timestamp.isoformat(),
        }
        for e in events
        if e.severity in (Severity.HIGH, Severity.CRITICAL)
    ][:limit]
    from .correlator import correlations_to_anomalies

    corr = correlations_to_anomalies(store.list_correlations())
    combined = corr + anomalies_out
    return {"anomalies": combined[:limit]}


@app.post("/api/v1/search")
def search(body: SearchRequest) -> dict:
    return store.search(body.query, body.host_id, body.limit)


@app.get("/api/v1/hunt/queries")
def hunt_queries() -> dict:
    return {"queries": hunt.list_queries()}


@app.post("/api/v1/hunt/run/{query_id}")
def hunt_run(query_id: str, host_id: str | None = Query(None), limit: int = Query(50)) -> dict:
    return hunt.run_query(query_id, host_id, limit)


@app.get("/api/v1/fabric/health")
def fabric_health() -> dict:
    return store.fabric_health()


@app.get("/api/v1/fleet/threat-summary")
def fleet_threat() -> dict:
    return store.fleet_threat_summary()


@app.get("/api/v1/sensors")
def sensors() -> dict:
    return {"sensors": store.list_sensors()}


@app.post("/api/v1/sensors/{host_id}/register")
def register_sensor(host_id: str, tetragon_version: str = Query("1.0.0")) -> dict:
    return store.register_sensor(host_id, tetragon_version)


@app.post("/api/v1/capture/start")
def capture_start(body: CaptureRequest) -> dict:
    store.register_sensor(body.host_id)
    return {"ok": True, "host_id": body.host_id, "duration_secs": body.duration_secs}


@app.get("/api/v1/fleet/timeline")
def fleet_timeline(hours: int = Query(24), limit: int = Query(200)) -> dict:
    return {"events": store.fleet_timeline(hours, limit)}


@app.get("/api/v1/network/overview")
def network_overview() -> dict:
    return network_brain.network_overview()


@app.get("/api/v1/network/service-map")
def network_service_map() -> dict:
    return network_brain.network_service_map()


@app.get("/api/v1/network/workloads")
def network_workloads() -> dict:
    return network_brain.network_workloads()


@app.get("/api/v1/network/timeline")
def network_timeline(limit: int = Query(40)) -> dict:
    return network_brain.network_timeline(limit=limit)


@app.get("/api/v1/network/threats")
def network_threats() -> dict:
    return network_brain.network_threats()


@app.get("/api/v1/network/top-talkers")
def network_top_talkers(limit: int = Query(10)) -> dict:
    return network_brain.network_top_talkers(limit=limit)


@app.get("/api/v1/nodes")
def k8s_nodes() -> dict:
    return network_brain.k8s_nodes()


@app.get("/api/v1/correlations")
def correlations() -> dict:
    return {"correlations": store.list_correlations()}


@app.get("/api/v1/asset-inventory")
def asset_inventory() -> dict:
    return store.asset_inventory()


@app.get("/api/v1/enforcement/status")
def enforcement_status() -> dict:
    return store.enforcement_status()


@app.get("/api/v1/enforcement/policies")
def enforcement_policies() -> dict:
    return {"policies": store.list_enforcement_policies()}


@app.get("/api/v1/enforcement/policies/{policy_id}")
def enforcement_policy(policy_id: str) -> dict:
    pol = store.get_enforcement_policy(policy_id)
    if not pol:
        raise HTTPException(status_code=404, detail="policy not found")
    from . import enforcer

    return {"policy": pol, "tetragon_policy": enforcer.to_tetragon_policy(enforcer.EnforcementPolicy(**pol))}


@app.post("/api/v1/enforcement/policies")
def create_enforcement_policy(body: enforcer.CreatePolicyRequest) -> dict:
    pol = store.create_enforcement_policy(body)
    return {"policy": pol}


@app.patch("/api/v1/enforcement/policies/{policy_id}")
def patch_enforcement_policy(policy_id: str, body: enforcer.PatchPolicyRequest) -> dict:
    result = store.patch_enforcement_policy(policy_id, body)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error", "policy not found"))
    return result


@app.delete("/api/v1/enforcement/policies/{policy_id}")
def delete_enforcement_policy(policy_id: str) -> dict:
    result = store.delete_enforcement_policy(policy_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error", "policy not found"))
    return result


@app.get("/api/v1/enforcement/policies/{policy_id}/tetragon")
def enforcement_policy_tetragon(policy_id: str) -> dict:
    result = store.get_enforcement_policy_tetragon(policy_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error", "policy not found"))
    return result


@app.post("/api/v1/enforcement/policies/{policy_id}/apply")
def apply_enforcement_policy(policy_id: str, body: enforcer.ApplyPolicyRequest) -> dict:
    return store.apply_enforcement_policy(policy_id, body.host_ids)


@app.get("/api/v1/hosts/{host_id}/enforcement")
def host_enforcement(host_id: str) -> dict:
    return store.host_enforcement(host_id)


@app.get("/api/v1/agents/{host_id}/bundle")
def agent_bundle(host_id: str) -> dict:
    return store.agent_bundle(host_id)


@app.post("/api/v1/agents/{host_id}/bundle/ack")
def agent_bundle_ack(host_id: str) -> dict:
    return store.ack_agent_bundle(host_id)


@app.post("/api/v1/agents/{host_id}/tetragon/queue")
def queue_tetragon_install(host_id: str) -> dict:
    return store.queue_tetragon_install(host_id)
