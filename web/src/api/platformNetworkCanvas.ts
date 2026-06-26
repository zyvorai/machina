// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Fleet network canvas — Machina topology + PacketWolf Network Brain (kubeconfig-backed).

import { platformFetch, type TopologyGraph } from './platform'

export type PacketWolfFlowEndpoint = {
  ip?: string
  namespace?: string
  pod?: string
}

export type PacketWolfFlow = {
  host_id?: string
  verdict?: string
  process?: string
  destination_ip?: string
  destination_port?: number
  summary?: string
  timestamp?: string
  /** Hubble / K8s flow shape from PacketWolf Network Brain */
  source?: PacketWolfFlowEndpoint
  destination?: PacketWolfFlowEndpoint
  port?: number
  protocol?: string
}

export type ServiceMapNode = {
  name: string
  namespace: string
  status?: string
  connections_in?: number
  connections_out?: number
  blocked_flows?: number
  risk?: string
}

export type ServiceMapEdge = {
  id: string
  source: string
  target: string
  source_key?: string
  target_key?: string
  health?: string
  flow_count?: number
  dropped_count?: number
  policy?: string
  is_external?: boolean
}

export type NetworkCanvasPayload = {
  topology: TopologyGraph
  flows: { flows?: PacketWolfFlow[]; note?: string }
  flow_stats: { dropped?: number; forwarded?: number; dropped_count?: number; allowed?: number }
  anomalies: { anomalies?: Array<{ summary?: string; description?: string; severity?: string; host_id?: string }>; note?: string }
  packetwolf: {
    enabled: boolean
    reachable: boolean
    summary: string
    base_url?: string
    discovery_source?: string
  }
  network_pulse: {
    enabled?: boolean
    overview?: Record<string, unknown>
    service_map?: {
      nodes?: ServiceMapNode[]
      edges?: ServiceMapEdge[]
      meta?: { stats?: { services?: number; connections?: number; blocked?: number; warnings?: number } }
      overlays?: { top_talker_nodes?: string[]; attack_path_workloads?: string[] }
    }
    workloads?: { workloads?: Array<{ namespace: string; name: string; status?: string }> }
    timeline?: { events?: Array<{ summary?: string; message?: string; severity?: string; timestamp?: string; kind?: string }> }
    threats?: { threats?: Array<{ title?: string; description?: string; severity?: string; summary?: string; kind?: string }> }
    top_talkers?: { talkers?: Array<{ name?: string; flows?: number }> }
    k8s_nodes?: { nodes?: Array<{ name: string; status: string; pods_count?: number }> }
    flow_stats?: Record<string, unknown>
    anomalies?: { anomalies?: Array<{ summary?: string; description?: string }> }
    note?: string
  }
}

export const getNetworkCanvas = () =>
  platformFetch<NetworkCanvasPayload>('/api/v1/network-canvas')
