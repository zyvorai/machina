// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { readJsonArray, readJsonObject, apiPost, apiPostVoid, apiDelete } from './client'

const API = '/api/v1'

export interface BackupInfo {
  id: string
  timestamp: string
  vm_filter: string
  vm_count: number
  net_count: number
  with_disks: boolean
  nfs_target: string
  size: string
  status: string
  status_message: string
  progress: string
  has_checksums: boolean
}

export interface BackupRequest {
  vm_name?: string
  with_disks?: boolean
  incremental?: boolean
  nfs_target?: string
  retain?: number
}

export interface RestoreRequest {
  backup_id: string
}

export interface BackupStatus {
  backup_id: string
  status: string
  message: string
  progress: string
  updated: string
}

export interface VerifyResult {
  backup_id: string
  verified: boolean
  files_checked: number
  files_ok: number
  files_failed: number
  failed_files: string[]
  errors: string
}

export interface ScheduleInfo {
  installed: boolean
  enabled: boolean
  active: boolean
  next_run: string
  last_run: string
}

export const fetchBackups = () => readJsonArray<BackupInfo>(`${API}/backups`)

export const triggerBackup = (req: BackupRequest) =>
  apiPost<{ status: string; backup_id: string }>(`${API}/backups`, req)

export const restoreBackup = (req: RestoreRequest) =>
  apiPostVoid(`${API}/backups/restore`, req)

export const deleteBackup = (id: string) =>
  apiDelete(`${API}/backups/${encodeURIComponent(id)}`)

export const getBackupStatus = (id: string) =>
  readJsonObject<BackupStatus>(`${API}/backups/${encodeURIComponent(id)}/status`)

export const verifyBackup = (id: string) =>
  apiPost<VerifyResult>(`${API}/backups/${encodeURIComponent(id)}/verify`)

export const downloadBackupUrl = (id: string) =>
  `${API}/backups/${encodeURIComponent(id)}/download`

export const getSchedule = () => readJsonObject<ScheduleInfo>(`${API}/backups/schedule`)

export const setSchedule = (enabled: boolean) =>
  apiPost<{ status: string; enabled: boolean }>(`${API}/backups/schedule`, { enabled })
