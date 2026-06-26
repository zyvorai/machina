// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! In-memory registry for long-running tasks (virt-image-build, VM create with logs).
//! Survives navigation away from the web UI while jobs run; cleared on daemon restart.

use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

const MAX_LOG_LINES: usize = 12_000;
const MAX_JOBS: usize = 250;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    VirtImageBuild,
    VmCreate,
    PackerGoldenBuild,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Clone, Serialize)]
pub struct JobSummary {
    pub id: String,
    pub kind: JobKind,
    pub title: String,
    pub status: JobStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vm_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_unix: u64,
    pub updated_unix: u64,
}

#[derive(Serialize)]
pub struct JobDetail {
    #[serde(flatten)]
    pub summary: JobSummary,
    pub logs: Vec<String>,
}

struct JobInner {
    summary: JobSummary,
    logs: Vec<String>,
}

#[derive(Clone, Default)]
pub struct JobRegistry {
    inner: Arc<Mutex<HashMap<Uuid, JobInner>>>,
    order: Arc<Mutex<VecDeque<Uuid>>>,
}

impl JobRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            order: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    fn now() -> u64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    pub fn start_virt_image_build(&self, os: &str, output: &str) -> Uuid {
        let id = Uuid::new_v4();
        let ts = Self::now();
        let title = format!("virt-image-build: {os} → {}", output.trim());
        let inner = JobInner {
            summary: JobSummary {
                id: id.to_string(),
                kind: JobKind::VirtImageBuild,
                title,
                status: JobStatus::Running,
                vm_name: None,
                target_path: Some(output.trim().to_string()),
                error: None,
                created_unix: ts,
                updated_unix: ts,
            },
            logs: Vec::new(),
        };
        let mut g = self.inner.lock().expect("job registry");
        g.insert(id, inner);
        let mut o = self.order.lock().expect("job order");
        o.push_front(id);
        while o.len() > MAX_JOBS {
            if let Some(old) = o.pop_back() {
                g.remove(&old);
            }
        }
        id
    }

    pub fn start_vm_create(&self, vm_name: &str) -> Uuid {
        let id = Uuid::new_v4();
        let ts = Self::now();
        let inner = JobInner {
            summary: JobSummary {
                id: id.to_string(),
                kind: JobKind::VmCreate,
                title: format!("Create VM: {vm_name}"),
                status: JobStatus::Running,
                vm_name: Some(vm_name.to_string()),
                target_path: None,
                error: None,
                created_unix: ts,
                updated_unix: ts,
            },
            logs: Vec::new(),
        };
        let mut g = self.inner.lock().expect("job registry");
        g.insert(id, inner);
        let mut o = self.order.lock().expect("job order");
        o.push_front(id);
        while o.len() > MAX_JOBS {
            if let Some(old) = o.pop_back() {
                g.remove(&old);
            }
        }
        id
    }

    pub fn start_packer_golden_build(&self, guest: &str) -> Uuid {
        let id = Uuid::new_v4();
        let ts = Self::now();
        let inner = JobInner {
            summary: JobSummary {
                id: id.to_string(),
                kind: JobKind::PackerGoldenBuild,
                title: format!("Golden Forge: {guest}"),
                status: JobStatus::Running,
                vm_name: None,
                target_path: None,
                error: None,
                created_unix: ts,
                updated_unix: ts,
            },
            logs: Vec::new(),
        };
        let mut g = self.inner.lock().expect("job registry");
        g.insert(id, inner);
        let mut o = self.order.lock().expect("job order");
        o.push_front(id);
        while o.len() > MAX_JOBS {
            if let Some(old) = o.pop_back() {
                g.remove(&old);
            }
        }
        id
    }

    pub fn append_log(&self, id: Uuid, line: &str) {
        let mut g = self.inner.lock().expect("job registry");
        let Some(j) = g.get_mut(&id) else {
            return;
        };
        j.logs.push(line.to_string());
        if j.logs.len() > MAX_LOG_LINES {
            let drop = j.logs.len() - MAX_LOG_LINES;
            j.logs.drain(0..drop);
        }
        j.summary.updated_unix = Self::now();
    }

    pub fn complete_virt_image(&self, id: Uuid, path: &str) {
        let mut g = self.inner.lock().expect("job registry");
        let Some(j) = g.get_mut(&id) else {
            return;
        };
        j.summary.status = JobStatus::Completed;
        j.summary.target_path = Some(path.to_string());
        j.summary.error = None;
        j.summary.updated_unix = Self::now();
    }

    pub fn complete_packer_golden(&self, id: Uuid, qcow2_path: &str) {
        let mut g = self.inner.lock().expect("job registry");
        let Some(j) = g.get_mut(&id) else {
            return;
        };
        j.summary.status = JobStatus::Completed;
        j.summary.target_path = Some(qcow2_path.to_string());
        j.summary.error = None;
        j.summary.updated_unix = Self::now();
    }

    pub fn complete_vm_create(&self, id: Uuid, name: &str) {
        let mut g = self.inner.lock().expect("job registry");
        let Some(j) = g.get_mut(&id) else {
            return;
        };
        j.summary.status = JobStatus::Completed;
        j.summary.vm_name = Some(name.to_string());
        j.summary.error = None;
        j.summary.updated_unix = Self::now();
    }

    pub fn fail(&self, id: Uuid, err: &str) {
        let mut g = self.inner.lock().expect("job registry");
        let Some(j) = g.get_mut(&id) else {
            return;
        };
        j.summary.status = JobStatus::Failed;
        j.summary.error = Some(err.to_string());
        j.summary.updated_unix = Self::now();
    }

    pub fn list_summaries(&self) -> Vec<JobSummary> {
        let o = self.order.lock().expect("job order");
        let g = self.inner.lock().expect("job registry");
        o.iter()
            .filter_map(|id| g.get(id).map(|j| j.summary.clone()))
            .collect()
    }

    pub fn get_detail(&self, id: &Uuid) -> Option<JobDetail> {
        let g = self.inner.lock().expect("job registry");
        g.get(id).map(|j| JobDetail {
            summary: j.summary.clone(),
            logs: j.logs.clone(),
        })
    }
}
