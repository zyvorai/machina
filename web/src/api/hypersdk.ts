// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { apiPost, readJsonObject } from './client'

const API = '/api/v1'

export interface HypersdkStatus {
  enabled: boolean
  base_url: string
  insecure_tls: boolean
  reachable: boolean
  last_error?: string
}

export interface HypersdkProvider {
  provider: string
  connected?: boolean
  name?: string
}

export interface HypersdkProviderVm {
  id?: string
  name: string
  status?: string
  provider?: string
}

export interface HypersdkMigrationJob {
  id?: string
  job_id?: string
  status?: string
  vm_name?: string
  created_at?: string
}

export function getHypersdkStatus(): Promise<HypersdkStatus> {
  return readJsonObject<HypersdkStatus>(`${API}/hypersdk/status`)
}

export function listHypersdkProviders(): Promise<{ providers?: HypersdkProvider[] } & HypersdkProvider[]> {
  return readJsonObject(`${API}/hypersdk/providers/list`)
}

export function listHypersdkProviderVms(provider: string): Promise<{ vms?: HypersdkProviderVm[] }> {
  return readJsonObject(`${API}/hypersdk/providers/vms?provider=${encodeURIComponent(provider)}`)
}

export function listHypersdkMigrationJobs(): Promise<{ jobs?: HypersdkMigrationJob[] }> {
  return readJsonObject(`${API}/hypersdk/migrations/jobs`)
}

export function getHypersdkMigrationJob(id: string): Promise<HypersdkMigrationJob> {
  return readJsonObject(`${API}/hypersdk/migrations/jobs/${encodeURIComponent(id)}`)
}

export function submitHypersdkMigration(config: Record<string, unknown>): Promise<{ job_id?: string; id?: string }> {
  return apiPost(`${API}/hypersdk/migrations/submit`, config)
}

export function hypersdkProxyGet(path: string): Promise<Record<string, unknown>> {
  return readJsonObject(`${API}/hypersdk/proxy?path=${encodeURIComponent(path)}`)
}

export function hypersdkProxyPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return apiPost(`${API}/hypersdk/proxy?path=${encodeURIComponent(path)}`, body)
}
