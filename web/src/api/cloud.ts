// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { platformFetch } from './platform'
export interface Vpc { id: string; project_id: string; host_id: string; name: string; cidr: string }
export interface Subnet { id: string; vpc_id: string; network_id: string; name: string; cidr: string; status: 'pending' | 'ready' | 'error'; last_error: string }
export interface ScalingPolicy { min: number; max: number; desired: number; target_cpu: number | null; cooldown_secs: number }
export interface InstanceGroup { id: string; project_id: string; template_id: string; subnet_id: string; name: string; policy_json: string; paused: boolean; last_scaled_at: string; last_error: string }
export interface LaunchTemplate { id: string; project_id: string; name: string }
export interface CloudPlan { vpc: Vpc; subnets: Subnet[]; routes: unknown[]; peerings: unknown[]; forwarding_active: boolean; backend: string; warnings: string[] }
const enc = encodeURIComponent
const project = (id: string) => `/api/v1/cloud/projects/${enc(id)}`
const vpc = (id: string) => `/api/v1/cloud/vpcs/${enc(id)}`
const post = <T>(path: string, body: unknown) => platformFetch<T>(path, { method: 'POST', body: JSON.stringify(body) })
export const listVpcs = (id: string) => platformFetch<Vpc[]>(`${project(id)}/vpcs`)
export const createVpc = (id: string, body: { name: string; cidr: string; host_id: string }) => post<Vpc>(`${project(id)}/vpcs`, body)
export const listSubnets = (id: string) => platformFetch<Subnet[]>(`${vpc(id)}/subnets`)
export const createSubnet = (id: string, body: { name: string; cidr: string }) => post<{ id: string; task_id: string }>(`${vpc(id)}/subnets`, body)
export const getCloudPlan = (id: string) => platformFetch<CloudPlan>(`${vpc(id)}/plan`)
export const retrySubnet = (id: string) => post<{ task_id: string }>(`/api/v1/cloud/subnets/${enc(id)}/retry`, {})
export const listInstanceGroups = (id: string) => platformFetch<InstanceGroup[]>(`${project(id)}/instance-groups`)
export const listLaunchTemplates = (id: string) => platformFetch<LaunchTemplate[]>(`${project(id)}/launch-templates`)
export const createLaunchTemplate = (id: string, name: string, vm: unknown) => post<LaunchTemplate>(`${project(id)}/launch-templates`, { name, vm })
export const createInstanceGroup = (id: string, body: { name: string; template_id: string; subnet_id: string; policy: ScalingPolicy }) => post<{ id: string }>(`${project(id)}/instance-groups`, body)
export const updateInstanceGroup = (id: string, policy: ScalingPolicy, paused: boolean) => platformFetch(`/api/v1/cloud/instance-groups/${enc(id)}`, { method: 'PATCH', body: JSON.stringify({ policy, paused }) })
