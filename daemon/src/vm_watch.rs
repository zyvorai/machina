// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Centralized VM state polling for `/ws/v1/watch`.
//!
//! Each WebSocket client previously polled libvirt independently (N clients → N×
//! `list_all_vms` every 2s). This coordinator runs one poll loop and broadcasts
//! JSON messages to all subscribers.

use std::collections::HashMap;

use machina_core::{LibvirtManager, VmInfo};
use tokio::sync::broadcast;
use tokio::time::{interval, Duration};
use tracing::warn;

const BROADCAST_CAPACITY: usize = 1024;
const POLL_INTERVAL_SECS: u64 = 2;

fn vm_watch_key(vm: &VmInfo) -> String {
    match &vm.libvirt_connection {
        Some(c) => format!("{c}/{}", vm.name),
        None => vm.name.clone(),
    }
}

fn diff_vms(
    prev_states: &HashMap<String, String>,
    current: &[VmInfo],
) -> (Vec<serde_json::Value>, HashMap<String, String>) {
    let mut changes = Vec::new();
    let mut current_names: HashMap<String, String> = HashMap::with_capacity(current.len());

    for vm in current {
        let key = vm_watch_key(vm);
        match prev_states.get(&key) {
            Some(old_state) if *old_state != vm.state => {
                changes.push(serde_json::json!({
                    "event": "state_change",
                    "name": vm.name,
                    "libvirt_connection": vm.libvirt_connection,
                    "old_state": old_state,
                    "new_state": vm.state,
                }));
            }
            None => {
                changes.push(serde_json::json!({
                    "event": "vm_added",
                    "name": vm.name,
                    "libvirt_connection": vm.libvirt_connection,
                    "state": vm.state,
                }));
            }
            _ => {}
        }
        current_names.insert(key, vm.state.clone());
    }

    for name in prev_states.keys() {
        if !current_names.contains_key(name) {
            changes.push(serde_json::json!({
                "event": "vm_removed",
                "name": name,
            }));
        }
    }

    (changes, current_names)
}

fn watch_message(changes: Vec<serde_json::Value>, vm_count: usize) -> String {
    let msg = if changes.is_empty() {
        serde_json::json!({ "event": "heartbeat", "vm_count": vm_count })
    } else {
        serde_json::json!({ "event": "changes", "changes": changes })
    };
    msg.to_string()
}

/// Shared VM watch broadcaster. Spawn once at daemon startup.
#[derive(Clone)]
pub struct VmWatchCoordinator {
    tx: broadcast::Sender<String>,
}

impl VmWatchCoordinator {
    pub fn spawn(manager: LibvirtManager) -> Self {
        let (tx, _) = broadcast::channel(BROADCAST_CAPACITY);
        let poller_tx = tx.clone();
        tokio::spawn(async move {
            let mut tick = interval(Duration::from_secs(POLL_INTERVAL_SECS));
            let mut prev_states: HashMap<String, String> = HashMap::new();
            loop {
                tick.tick().await;
                if poller_tx.receiver_count() == 0 {
                    prev_states.clear();
                    continue;
                }
                let manager2 = manager.clone();
                let current =
                    match tokio::task::spawn_blocking(move || manager2.list_all_vms()).await {
                        Ok(Ok(vms)) => vms,
                        Ok(Err(e)) => {
                            warn!("VmWatchCoordinator list_all_vms failed: {e}");
                            continue;
                        }
                        Err(e) => {
                            warn!("VmWatchCoordinator join error: {e}");
                            continue;
                        }
                    };
                let (changes, next_states) = diff_vms(&prev_states, &current);
                prev_states = next_states;
                let payload = watch_message(changes, current.len());
                let _ = poller_tx.send(payload);
            }
        });
        Self { tx }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }

    pub fn subscriber_count(&self) -> usize {
        self.tx.receiver_count()
    }
}
