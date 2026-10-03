# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

"""Saved threat-hunt queries for OpenSearch-backed search."""

from __future__ import annotations

from typing import Any

from . import search_index
from . import store

HUNT_QUERIES: list[dict[str, str]] = [
    {
        "id": "reverse-shell",
        "name": "Reverse shell listeners",
        "query": "nc OR netcat OR /dev/tcp OR bash -i",
        "description": "Process exec patterns common in reverse-shell staging",
        "severity": "critical",
    },
    {
        "id": "suspicious-dns",
        "name": "Suspicious DNS exfil",
        "query": "dns OR query OR pastebin OR ngrok",
        "description": "DNS queries to common staging and tunnel domains",
        "severity": "high",
    },
    {
        "id": "priv-esc",
        "name": "Privilege escalation",
        "query": "sudo OR su OR setuid OR pkexec",
        "description": "Privilege changes and setuid execution",
        "severity": "high",
    },
    {
        "id": "crypto-miner",
        "name": "Crypto miner processes",
        "query": "xmrig OR minerd OR stratum OR monero",
        "description": "Known miner binaries and pool keywords",
        "severity": "high",
    },
    {
        "id": "lateral-movement",
        "name": "Lateral movement tools",
        "query": "ssh OR scp OR rsync OR kubectl OR curl",
        "description": "Remote access and orchestration tooling",
        "severity": "medium",
    },
    {
        "id": "sensitive-files",
        "name": "Sensitive file access",
        "query": "shadow OR authorized_keys OR sudoers OR id_rsa",
        "description": "Reads/writes to credential and auth files",
        "severity": "critical",
    },
    {
        "id": "dns-tunneling",
        "name": "DNS tunneling labels",
        "query": "dns OR query OR entropy OR tunnel",
        "description": "High-entropy long DNS labels indicative of tunneling",
        "severity": "high",
    },
    {
        "id": "lateral-ssh",
        "name": "Lateral SSH movement",
        "query": "ssh OR scp OR rsync OR lateral",
        "description": "SSH/SCP burst patterns across fleet hosts",
        "severity": "high",
    },
    {
        "id": "container-escape",
        "name": "Container escape indicators",
        "query": "hostPID OR hostNetwork OR /proc/ OR container escape",
        "description": "Sensitive mount and host namespace abuse from k8s workloads",
        "severity": "critical",
    },
]


def list_queries() -> list[dict[str, str]]:
    return list(HUNT_QUERIES)


def run_query(query_id: str, host_id: str | None = None, limit: int = 50) -> dict[str, Any]:
    spec = next((q for q in HUNT_QUERIES if q["id"] == query_id), None)
    if not spec:
        return {"ok": False, "error": f"unknown hunt query: {query_id}"}
    payload = store.search(spec["query"], host_id, limit)
    payload["query_id"] = query_id
    payload["query_name"] = spec["name"]
    payload["query_description"] = spec["description"]
    payload["severity"] = spec["severity"]
    payload["ok"] = True
    return payload
