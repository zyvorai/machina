# Copyright 2026 Zyvor AI Labs · https://zyvor.dev
# SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


class EventKind(str, Enum):
    PROCESS_EXEC = "process_exec"
    NETWORK_CONNECT = "network_connect"
    DNS_QUERY = "dns_query"
    FILE_WRITE = "file_write"
    PRIVILEGE_ESC = "privilege_esc"
    SECURITY = "security"


class Severity(str, Enum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ProcessInfo(BaseModel):
    pid: int = 0
    ppid: int = 0
    user: str = ""
    binary: str = ""
    args: str = ""


class NetworkInfo(BaseModel):
    src_ip: str = ""
    dst_ip: str = ""
    port: int = 0
    protocol: str = "tcp"


class DnsInfo(BaseModel):
    query: str = ""
    response: str = ""


class FileInfo(BaseModel):
    path: str = ""
    action: str = ""


class K8sInfo(BaseModel):
    namespace: str = ""
    pod: str = ""
    container: str = ""
    deployment: str = ""


class SecurityEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    host_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    kind: EventKind
    severity: Severity = Severity.INFO
    process: ProcessInfo = Field(default_factory=ProcessInfo)
    network: NetworkInfo = Field(default_factory=NetworkInfo)
    dns: DnsInfo = Field(default_factory=DnsInfo)
    file: FileInfo = Field(default_factory=FileInfo)
    k8s: K8sInfo = Field(default_factory=K8sInfo)
    verdict: str = "observed"
    summary: str = ""
    raw_tetragon: dict[str, Any] = Field(default_factory=dict)


class IngestBatch(BaseModel):
    events: list[dict[str, Any]]


class SearchRequest(BaseModel):
    query: str
    host_id: str | None = None
    limit: int = 50


class CaptureRequest(BaseModel):
    host_id: str
    duration_secs: int = 300
