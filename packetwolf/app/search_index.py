# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

"""Optional OpenSearch indexing for security events."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

OPENSEARCH_URL = os.environ.get("OPENSEARCH_URL", "").rstrip("/")
INDEX = "packetwolf-events"

INDEX_BODY = {
    "settings": {"number_of_shards": 1, "number_of_replicas": 0},
    "mappings": {
        "properties": {
            "id": {"type": "keyword"},
            "host_id": {"type": "keyword"},
            "timestamp": {"type": "date"},
            "kind": {"type": "keyword"},
            "severity": {"type": "keyword"},
            "summary": {"type": "text"},
            "process": {
                "properties": {
                    "binary": {"type": "text"},
                    "args": {"type": "text"},
                    "user": {"type": "keyword"},
                }
            },
            "dns": {"properties": {"query": {"type": "text"}}},
            "file": {"properties": {"path": {"type": "text"}}},
        }
    },
}


def configured() -> bool:
    return bool(OPENSEARCH_URL)


def ping() -> bool:
    if not OPENSEARCH_URL:
        return False
    url = f"{OPENSEARCH_URL}/_cluster/health"
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            payload = json.loads(resp.read().decode())
            return payload.get("status") in ("green", "yellow")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return False


def ensure_index() -> bool:
    if not OPENSEARCH_URL:
        return False
    head = urllib.request.Request(f"{OPENSEARCH_URL}/{INDEX}", method="HEAD")
    try:
        with urllib.request.urlopen(head, timeout=3) as resp:
            if resp.status == 200:
                return True
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            return False
    except (urllib.error.URLError, TimeoutError, OSError):
        return False
    body = json.dumps(INDEX_BODY).encode()
    put = urllib.request.Request(
        f"{OPENSEARCH_URL}/{INDEX}",
        data=body,
        method="PUT",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(put, timeout=5) as resp:
            return 200 <= resp.status < 300
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def index_stats() -> dict[str, Any]:
    if not OPENSEARCH_URL:
        return {"configured": False, "reachable": False, "document_count": 0}
    if not ping():
        return {"configured": True, "reachable": False, "document_count": 0}
    url = f"{OPENSEARCH_URL}/{INDEX}/_count"
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            payload = json.loads(resp.read().decode())
            return {
                "configured": True,
                "reachable": True,
                "document_count": int(payload.get("count", 0)),
            }
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return {"configured": True, "reachable": False, "document_count": 0}


def index_event(event: dict[str, Any]) -> None:
    if not OPENSEARCH_URL:
        return
    doc_id = event.get("id", "")
    if not doc_id:
        return
    url = f"{OPENSEARCH_URL}/{INDEX}/_doc/{doc_id}"
    data = json.dumps(event).encode()
    req = urllib.request.Request(url, data=data, method="PUT", headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=3)
    except (urllib.error.URLError, TimeoutError, OSError):
        pass


def search(query: str, host_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    if not OPENSEARCH_URL or not ping():
        return []
    must: list[dict] = [{"query_string": {"query": query or "*", "default_field": "summary"}}]
    if host_id:
        must.append({"term": {"host_id": host_id}})
    body = json.dumps({"size": limit, "query": {"bool": {"must": must}}, "sort": [{"timestamp": "desc"}]}).encode()
    url = f"{OPENSEARCH_URL}/{INDEX}/_search"
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            payload = json.loads(resp.read().decode())
            hits = payload.get("hits", {}).get("hits", [])
            out = []
            for h in hits:
                src = h.get("_source", {})
                if isinstance(src, dict):
                    src = dict(src)
                    src["search_source"] = "opensearch"
                    out.append(src)
            return out
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return []
