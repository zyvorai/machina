# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

"""Runtime eBPF enforcement policies — Tetragon TracingPolicy generation + evaluation."""

from __future__ import annotations

import fnmatch
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


class EnforceKind(str, Enum):
    DENY_PROCESS = "deny_process"
    DENY_DNS = "deny_dns"
    DENY_PORT = "deny_port"
    DENY_IP = "deny_ip"
    DENY_FILE = "deny_file"
    DENY_CAP = "deny_cap"
    DENY_NAMESPACE = "deny_namespace"


class EnforcementPolicy(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    kind: EnforceKind
    match: str
    enabled: bool = True
    scope: str = "fleet"  # fleet | host | k8s
    host_ids: list[str] = Field(default_factory=list)
    description: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    applied_hosts: list[str] = Field(default_factory=list)


class CreatePolicyRequest(BaseModel):
    name: str
    kind: EnforceKind
    match: str
    enabled: bool = True
    scope: str = "fleet"
    host_ids: list[str] = Field(default_factory=list)
    description: str = ""


class ApplyPolicyRequest(BaseModel):
    host_ids: list[str]


class PatchPolicyRequest(BaseModel):
    enabled: bool | None = None
    match: str | None = None
    description: str | None = None


def tetragon_policy_name(policy_id: str) -> str:
    return f"packetwolf-{policy_id}"


def default_policies() -> list[EnforcementPolicy]:
    return [
        EnforcementPolicy(
            id="pol-deny-nc",
            name="Block reverse-shell listeners",
            kind=EnforceKind.DENY_PROCESS,
            match="/usr/bin/nc",
            description="Deny netcat listeners commonly used in reverse shells",
            applied_hosts=["h1"],
        ),
        EnforcementPolicy(
            id="pol-deny-suspicious-dns",
            name="Block suspicious TLD DNS",
            kind=EnforceKind.DENY_DNS,
            match="*.xyz",
            description="Deny DNS lookups to suspicious TLD patterns",
        ),
        EnforcementPolicy(
            id="pol-deny-c2-port",
            name="Block C2 port 4444",
            kind=EnforceKind.DENY_PORT,
            match="4444/tcp",
            description="Deny outbound connections to port 4444",
            applied_hosts=["h1"],
        ),
        EnforcementPolicy(
            id="pol-deny-tor-exit",
            name="Block known Tor exit range",
            kind=EnforceKind.DENY_IP,
            match="185.220.100.0/24",
            description="Deny traffic to a sample Tor exit CIDR",
        ),
        EnforcementPolicy(
            id="pol-deny-shadow-read",
            name="Block shadow file read",
            kind=EnforceKind.DENY_FILE,
            match="/etc/shadow",
            description="Deny open/write on /etc/shadow",
            applied_hosts=["h1"],
        ),
        EnforcementPolicy(
            id="pol-deny-raw-socket",
            name="Block raw socket capability",
            kind=EnforceKind.DENY_CAP,
            match="CAP_NET_RAW",
            description="Deny CAP_NET_RAW for packet capture abuse",
        ),
    ]


def to_tetragon_policy(policy: EnforcementPolicy) -> dict[str, Any]:
    """Emit a TracingPolicy-shaped document for Tetragon / agent apply."""
    base = {
        "apiVersion": "cilium.io/v1alpha1",
        "kind": "TracingPolicy",
        "metadata": {"name": tetragon_policy_name(policy.id)},
    }
    if policy.kind == EnforceKind.DENY_PROCESS:
        base["spec"] = {
            "kprobes": [
                {
                    "call": "security_bprm_check",
                    "syscall": "execve",
                    "args": [{"index": 0, "type": "string"}],
                    "selectors": [
                        {
                            "matchBinaries": [{"operator": "In", "values": [policy.match]}],
                            "matchActions": [{"action": "Sigkill"}],
                        }
                    ],
                }
            ]
        }
    elif policy.kind == EnforceKind.DENY_DNS:
        base["spec"] = {
            "kprobes": [
                {
                    "call": "dns",
                    "selectors": [
                        {
                            "matchArgs": [{"index": 0, "operator": "Prefix", "values": [policy.match.replace("*.", "")]}],
                            "matchActions": [{"action": "Post"}],
                        }
                    ],
                }
            ]
        }
    elif policy.kind == EnforceKind.DENY_PORT:
        port, _, proto = policy.match.partition("/")
        base["spec"] = {
            "kprobes": [
                {
                    "call": "tcp_connect",
                    "selectors": [
                        {
                            "matchArgs": [{"index": 2, "operator": "Equal", "values": [port]}],
                            "matchActions": [{"action": "Sigkill"}],
                        }
                    ],
                }
            ],
            "protocol": proto or "tcp",
        }
    elif policy.kind == EnforceKind.DENY_FILE:
        base["spec"] = {
            "kprobes": [
                {
                    "call": "security_file_open",
                    "syscall": "open",
                    "args": [{"index": 0, "type": "string"}],
                    "selectors": [
                        {
                            "matchArgs": [{"index": 0, "operator": "Prefix", "values": [policy.match.rstrip("*")]}],
                            "matchActions": [{"action": "Post"}, {"action": "Sigkill"}],
                        }
                    ],
                }
            ]
        }
    elif policy.kind == EnforceKind.DENY_CAP:
        base["spec"] = {
            "kprobes": [
                {
                    "call": "cap_capable",
                    "selectors": [
                        {
                            "matchCapabilities": [{"type": "Effective", "operator": "In", "values": [policy.match]}],
                            "matchActions": [{"action": "Sigkill"}],
                        }
                    ],
                }
            ]
        }
    elif policy.kind == EnforceKind.DENY_NAMESPACE:
        base["spec"] = {
            "podSelector": {},
            "namespaceSelector": {"matchLabels": {}},
            "k8s": [
                {
                    "namespace": policy.match,
                    "selectors": [{"matchActions": [{"action": "Post"}]}],
                }
            ],
        }
    else:
        base["spec"] = {
            "kprobes": [
                {
                    "call": "tcp_connect",
                    "selectors": [
                        {
                            "matchArgs": [{"index": 1, "operator": "Equal", "values": [policy.match]}],
                            "matchActions": [{"action": "Sigkill"}],
                        }
                    ],
                }
            ]
        }
    return base


def _dns_matches(pattern: str, query: str) -> bool:
    p = pattern.lower().strip()
    q = query.lower().strip()
    if p.startswith("*."):
        return q.endswith(p[1:]) or fnmatch.fnmatch(q, p)
    return fnmatch.fnmatch(q, p) or q == p


def _ip_in_cidr(cidr: str, ip: str) -> bool:
    if not ip or not cidr:
        return False
    if "/" not in cidr:
        return ip == cidr
    net, bits_str = cidr.split("/", 1)
    try:
        bits = int(bits_str)
    except ValueError:
        return False
    def to_int(addr: str) -> int:
        parts = [int(x) for x in addr.split(".")]
        return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
    try:
        mask = (0xFFFFFFFF << (32 - bits)) & 0xFFFFFFFF
        return (to_int(ip) & mask) == (to_int(net) & mask)
    except (ValueError, IndexError):
        return False


def evaluate_event(event: dict[str, Any], policies: list[EnforcementPolicy], host_id: str) -> str | None:
    """Return policy id if event would be denied by an enabled applied policy."""
    for pol in policies:
        if not _policy_applies_to_host(pol, host_id):
            continue

        kind = event.get("kind", "")
        if pol.kind == EnforceKind.DENY_PROCESS:
            binary = (event.get("process") or {}).get("binary", "")
            if binary and (pol.match in binary or fnmatch.fnmatch(binary, pol.match)):
                return pol.id
        elif pol.kind == EnforceKind.DENY_DNS and kind == "dns_query":
            query = (event.get("dns") or {}).get("query", "")
            if _dns_matches(pol.match, query):
                return pol.id
        elif pol.kind == EnforceKind.DENY_PORT and kind in ("network_connect", "security"):
            port = (event.get("network") or {}).get("port", 0)
            match_port = pol.match.split("/")[0]
            if str(port) == match_port:
                return pol.id
        elif pol.kind == EnforceKind.DENY_IP and kind == "network_connect":
            dst = (event.get("network") or {}).get("dst_ip", "")
            if _ip_in_cidr(pol.match, dst) or dst == pol.match:
                return pol.id
        elif pol.kind == EnforceKind.DENY_FILE and kind in ("file_open", "file_write", "security"):
            path = (event.get("file") or {}).get("path", "")
            if path and (fnmatch.fnmatch(path, pol.match) or path.startswith(pol.match.rstrip("*"))):
                return pol.id
        elif pol.kind == EnforceKind.DENY_CAP and kind in ("capability", "security"):
            cap = (event.get("process") or {}).get("capability", "") or event.get("capability", "")
            if cap and pol.match in str(cap):
                return pol.id
        elif pol.kind == EnforceKind.DENY_NAMESPACE:
            ns = (event.get("k8s") or {}).get("namespace", "")
            if ns and (ns == pol.match or fnmatch.fnmatch(ns, pol.match)):
                return pol.id
    return None


def _policy_applies_to_host(pol: EnforcementPolicy, host_id: str) -> bool:
    if not pol.enabled:
        return False
    if pol.scope == "host" and pol.host_ids:
        return host_id in pol.host_ids
    if pol.applied_hosts:
        return host_id in pol.applied_hosts
    return True
