// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

use anyhow::Result;
use machina_core::format_http_error_body;
use machina_core::libvirt::extras::BrowseDirResponse;
use machina_core::{
    BackupInfo, BackupRequest, CloneVmRequest, CreateInstanceRequest, CreateNetworkRequest,
    CreateSnapshotRequest, NetworkInfo, NodeInfo, OpenStackConnectionStatus,
    AssociateFloatingIpRequest, AttachVolumeRequest, OpenStackAttachedVolume, OpenStackFloatingIp,
    OpenStackFlavor, OpenStackImage, OpenStackInstance, OpenStackKeyPair, OpenStackNetwork,
    OpenStackRemoteConsole, RenameVmRequest, RestoreRequest, SnapshotInfo,
    StoragePoolInfo, VmDetails, VmInfo, VmMetrics,
};

pub struct DaemonClient {
    base_url: String,
    client: reqwest::Client,
}

impl DaemonClient {
    pub fn new(base_url: &str) -> Self {
        // Self-signed certs from install.sh are normal; trust for local admin tool (same as curl -k).
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .expect("reqwest client");
        Self {
            base_url: base_url.to_string(),
            client,
        }
    }

    // ── Unified HTTP helpers ────────────────────────────────────────────

    fn http_error(status: reqwest::StatusCode, body: &str) -> anyhow::Error {
        let reason = status.canonical_reason().unwrap_or("");
        anyhow::anyhow!(format_http_error_body(
            status.as_u16(),
            reason,
            body,
        ))
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self.client.get(&url).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(Self::http_error(status, &body));
        }
        Ok(resp.json().await?)
    }

    async fn get_text(&self, path: &str) -> Result<String> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self.client.get(&url).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(Self::http_error(status, &body));
        }
        Ok(resp.text().await?)
    }

    async fn post_action(&self, path: &str) -> Result<()> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self.client.post(&url).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(Self::http_error(status, &body));
        }
        Ok(())
    }

    async fn post_json<T: serde::Serialize>(&self, path: &str, body: &T) -> Result<()> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self.client.post(&url).json(body).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(Self::http_error(status, &body));
        }
        Ok(())
    }

    async fn delete_action(&self, path: &str) -> Result<()> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self.client.delete(&url).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(Self::http_error(status, &body));
        }
        Ok(())
    }

    async fn put_json<T: serde::Serialize>(&self, path: &str, body: &T) -> Result<()> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self.client.put(&url).json(body).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(Self::http_error(status, &body));
        }
        Ok(())
    }

    fn error_suggests_nvram_undefine_needed(msg: &str) -> bool {
        let m = msg.to_lowercase();
        m.contains("nvram") && (m.contains("undefine") || m.contains("cannot remove domain"))
    }

    // ── VMs ─────────────────────────────────────────────────────────────

    pub async fn fetch_vms(&self) -> Result<Vec<VmInfo>> {
        self.get_json("/api/v1/vms").await
    }

    pub async fn get_vm_details(&self, name: &str) -> Result<VmDetails> {
        self.get_json(&format!("/api/v1/vms/{name}")).await
    }

    pub async fn get_vm_xml(&self, name: &str) -> Result<String> {
        self.get_text(&format!("/api/v1/vms/{name}/xml")).await
    }

    pub async fn start_vm(&self, name: &str) -> Result<()> {
        self.post_action(&format!("/api/v1/vms/{name}/start")).await
    }

    pub async fn stop_vm(&self, name: &str) -> Result<()> {
        self.post_action(&format!("/api/v1/vms/{name}/stop")).await
    }

    pub async fn shutdown_vm(&self, name: &str) -> Result<()> {
        self.post_action(&format!("/api/v1/vms/{name}/shutdown"))
            .await
    }

    pub async fn reboot_vm(&self, name: &str) -> Result<()> {
        self.post_action(&format!("/api/v1/vms/{name}/reboot"))
            .await
    }

    pub async fn pause_vm(&self, name: &str) -> Result<()> {
        self.post_action(&format!("/api/v1/vms/{name}/pause")).await
    }

    pub async fn resume_vm(&self, name: &str) -> Result<()> {
        self.post_action(&format!("/api/v1/vms/{name}/resume"))
            .await
    }

    pub async fn delete_vm(&self, name: &str) -> Result<()> {
        let path = format!("/api/v1/vms/{name}");
        match self.delete_action(&path).await {
            Ok(()) => Ok(()),
            Err(e) => {
                let msg = e.to_string();
                if Self::error_suggests_nvram_undefine_needed(&msg) {
                    let retry = format!("{path}?undefine_nvram=true");
                    self.delete_action(&retry).await
                } else {
                    Err(e)
                }
            }
        }
    }

    pub async fn clone_vm(&self, source: &str, new_name: &str) -> Result<()> {
        let req = CloneVmRequest {
            new_name: new_name.to_string(),
        };
        self.post_json(&format!("/api/v1/vms/{source}/clone"), &req)
            .await
    }

    pub async fn rename_vm(&self, name: &str, new_name: &str) -> Result<()> {
        let req = RenameVmRequest {
            new_name: new_name.to_string(),
        };
        self.post_json(&format!("/api/v1/vms/{name}/rename"), &req)
            .await
    }

    pub async fn set_autostart(&self, name: &str, enabled: bool) -> Result<()> {
        self.post_action(&format!("/api/v1/vms/{name}/autostart/{enabled}"))
            .await
    }

    pub async fn set_vcpus(&self, name: &str, count: u32) -> Result<()> {
        self.post_action(&format!("/api/v1/vms/{name}/vcpus/{count}"))
            .await
    }

    pub async fn set_memory(&self, name: &str, mb: u64) -> Result<()> {
        self.post_action(&format!("/api/v1/vms/{name}/memory/{mb}"))
            .await
    }

    // ── Networks ────────────────────────────────────────────────────────

    pub async fn fetch_networks(&self) -> Result<Vec<NetworkInfo>> {
        self.get_json("/api/v1/networks").await
    }

    pub async fn start_network(&self, name: &str) -> Result<()> {
        self.post_action(&format!("/api/v1/networks/{name}/start"))
            .await
    }

    pub async fn stop_network(&self, name: &str) -> Result<()> {
        self.post_action(&format!("/api/v1/networks/{name}/stop"))
            .await
    }

    pub async fn create_network(&self, req: &CreateNetworkRequest) -> Result<()> {
        self.post_json("/api/v1/networks", req).await
    }

    pub async fn delete_network(&self, name: &str) -> Result<()> {
        self.delete_action(&format!("/api/v1/networks/{name}"))
            .await
    }

    pub async fn set_network_autostart(&self, name: &str, enabled: bool) -> Result<()> {
        self.post_action(&format!("/api/v1/networks/{name}/autostart/{enabled}"))
            .await
    }

    pub async fn get_network_xml(&self, name: &str) -> Result<String> {
        self.get_text(&format!("/api/v1/networks/{name}/xml")).await
    }

    // ── Storage ─────────────────────────────────────────────────────────

    pub async fn fetch_storage_pools(&self) -> Result<Vec<StoragePoolInfo>> {
        self.get_json("/api/v1/storage/pools").await
    }

    pub async fn start_pool(&self, name: &str) -> Result<()> {
        self.post_action(&format!("/api/v1/storage/pools/{name}/start"))
            .await
    }

    pub async fn stop_pool(&self, name: &str) -> Result<()> {
        self.post_action(&format!("/api/v1/storage/pools/{name}/stop"))
            .await
    }

    pub async fn fetch_volumes(&self, pool: &str) -> Result<Vec<machina_core::StorageVolumeInfo>> {
        self.get_json(&format!("/api/v1/storage/pools/{pool}/volumes"))
            .await
    }

    pub async fn set_pool_autostart(&self, name: &str, enabled: bool) -> Result<()> {
        self.post_action(&format!("/api/v1/storage/pools/{name}/autostart/{enabled}"))
            .await
    }

    pub async fn refresh_pool(&self, name: &str) -> Result<()> {
        self.post_action(&format!("/api/v1/storage/pools/{name}/refresh"))
            .await
    }

    pub async fn delete_volume(&self, pool: &str, vol: &str) -> Result<()> {
        self.delete_action(&format!("/api/v1/storage/pools/{pool}/volumes/{vol}"))
            .await
    }

    // ── Snapshots ───────────────────────────────────────────────────────

    pub async fn fetch_all_snapshots(&self) -> Result<Vec<SnapshotInfo>> {
        self.get_json("/api/v1/snapshots").await
    }

    pub async fn create_snapshot(&self, vm_name: &str, snap_name: &str, desc: &str) -> Result<()> {
        let req = CreateSnapshotRequest {
            name: snap_name.to_string(),
            description: desc.to_string(),
            disk_only: false,
            storage_mode: String::new(),
            memory_snapshot: String::new(),
            memory_file: String::new(),
            external_disk_dir: String::new(),
            external_memory_dir: String::new(),
            disks: Vec::new(),
            atomic: true,
            reuse_external: false,
        };
        self.post_json(&format!("/api/v1/vms/{vm_name}/snapshots"), &req)
            .await
    }

    pub async fn delete_snapshot(&self, vm_name: &str, snap_name: &str) -> Result<()> {
        self.delete_action(&format!("/api/v1/vms/{vm_name}/snapshots/{snap_name}"))
            .await
    }

    pub async fn revert_snapshot(&self, vm_name: &str, snap_name: &str) -> Result<()> {
        self.post_action(&format!(
            "/api/v1/vms/{vm_name}/snapshots/{snap_name}/revert"
        ))
        .await
    }

    // ── Node / Metrics ──────────────────────────────────────────────────

    pub async fn fetch_node_info(&self) -> Result<NodeInfo> {
        self.get_json("/api/v1/node").await
    }

    pub async fn fetch_metrics(&self) -> Result<Vec<VmMetrics>> {
        self.get_json("/api/v1/metrics").await
    }

    // ── Console ─────────────────────────────────────────────────────────

    pub async fn get_console_info(&self, name: &str) -> Result<serde_json::Value> {
        self.get_json(&format!("/api/v1/vms/console-info/{name}"))
            .await
    }

    // ── Backups ─────────────────────────────────────────────────────────

    pub async fn fetch_backups(&self) -> Result<Vec<BackupInfo>> {
        self.get_json("/api/v1/backups").await
    }

    pub async fn trigger_backup(&self, req: &BackupRequest) -> Result<()> {
        self.post_json("/api/v1/backups", req).await
    }

    pub async fn restore_backup(&self, backup_id: &str) -> Result<()> {
        let req = RestoreRequest {
            backup_id: backup_id.to_string(),
        };
        self.post_json("/api/v1/backups/restore", &req).await
    }

    pub async fn delete_backup(&self, id: &str) -> Result<()> {
        self.delete_action(&format!("/api/v1/backups/{id}")).await
    }

    // ── Host browse / KubeVirt ─────────────────────────────────────────

    pub async fn browse_directory(&self, path: &str) -> Result<BrowseDirResponse> {
        let url = format!("{}/api/v1/browse/dir", self.base_url);
        let req = if path.trim().is_empty() {
            self.client.get(&url)
        } else {
            self.client.get(&url).query(&[("path", path)])
        };
        let resp = req.send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(Self::http_error(status, &body));
        }
        Ok(resp.json().await?)
    }

    pub async fn get_kubevirt_bundle_yaml(&self, vm: &str) -> Result<String> {
        let v: serde_json::Value = self
            .get_json(&format!("/api/v1/vms/{vm}/kubevirt-bundle"))
            .await?;
        v.get("yaml")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow::anyhow!("kubevirt-bundle response missing yaml"))
    }

    /// `op`: `apply` | `upload` | `start` — POST body is JSON overrides (same keys as kubevirt-bundle query).
    // ── OpenStack (Nova/Glance) — parity with web /api/v1/openstack/* ───

    async fn post_json_value(&self, path: &str, body: &serde_json::Value) -> Result<serde_json::Value> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self.client.post(&url).json(body).send().await?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(Self::http_error(status, &text));
        }
        serde_json::from_str(&text).map_err(|e| anyhow::anyhow!("invalid JSON: {e}; body: {text}"))
    }

    pub async fn openstack_status(&self) -> Result<OpenStackConnectionStatus> {
        self.get_json("/api/v1/openstack/status").await
    }

    pub async fn openstack_test_connection(&self) -> Result<OpenStackConnectionStatus> {
        self.post_json_value("/api/v1/openstack/test-connection", &serde_json::json!({}))
            .await
            .and_then(|v| {
                serde_json::from_value(v)
                    .map_err(|e| anyhow::anyhow!("openstack test-connection: {e}"))
            })
    }

    pub async fn openstack_list_instances(&self) -> Result<Vec<OpenStackInstance>> {
        #[derive(serde::Deserialize)]
        struct R {
            instances: Vec<OpenStackInstance>,
        }
        let r: R = self.get_json("/api/v1/openstack/instances").await?;
        Ok(r.instances)
    }

    pub async fn openstack_get_instance(&self, id: &str) -> Result<OpenStackInstance> {
        self.get_json(&format!("/api/v1/openstack/instances/{id}"))
            .await
    }

    pub async fn openstack_list_images(&self) -> Result<Vec<OpenStackImage>> {
        #[derive(serde::Deserialize)]
        struct R {
            images: Vec<OpenStackImage>,
        }
        let r: R = self.get_json("/api/v1/openstack/images").await?;
        Ok(r.images)
    }

    pub async fn openstack_list_flavors(&self) -> Result<Vec<OpenStackFlavor>> {
        #[derive(serde::Deserialize)]
        struct R {
            flavors: Vec<OpenStackFlavor>,
        }
        let r: R = self.get_json("/api/v1/openstack/flavors").await?;
        Ok(r.flavors)
    }

    pub async fn openstack_list_networks(&self) -> Result<Vec<OpenStackNetwork>> {
        #[derive(serde::Deserialize)]
        struct R {
            networks: Vec<OpenStackNetwork>,
        }
        let r: R = self.get_json("/api/v1/openstack/networks").await?;
        Ok(r.networks)
    }

    pub async fn openstack_list_keypairs(&self) -> Result<Vec<OpenStackKeyPair>> {
        #[derive(serde::Deserialize)]
        struct R {
            keypairs: Vec<OpenStackKeyPair>,
        }
        let r: R = self.get_json("/api/v1/openstack/keypairs").await?;
        Ok(r.keypairs)
    }

    pub async fn openstack_instance_action(&self, id: &str, action: &str) -> Result<()> {
        self.post_action(&format!(
            "/api/v1/openstack/instances/{id}/{action}"
        ))
        .await
    }

    pub async fn openstack_reboot_instance(&self, id: &str, soft: bool) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/instances/{id}/reboot"),
            &serde_json::json!({ "reboot_type": if soft { "soft" } else { "hard" } }),
        )
        .await
    }

    pub async fn openstack_snapshot_instance(&self, id: &str, image_name: &str) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/instances/{id}/snapshot"),
            &serde_json::json!({ "image_name": image_name }),
        )
        .await
    }

    pub async fn openstack_resize_instance(
        &self,
        id: &str,
        flavor: &str,
        auto_confirm: bool,
    ) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/instances/{id}/resize"),
            &serde_json::json!({ "flavor": flavor, "auto_confirm": auto_confirm }),
        )
        .await
    }

    pub async fn openstack_confirm_resize(&self, id: &str) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/instances/{id}/confirm-resize"),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn openstack_revert_resize(&self, id: &str) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/instances/{id}/revert-resize"),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn openstack_get_quotas(&self) -> Result<serde_json::Value> {
        self.get_json("/api/v1/openstack/quotas").await
    }

    pub async fn openstack_list_volume_snapshots(&self) -> Result<serde_json::Value> {
        self.get_json("/api/v1/openstack/volume-snapshots").await
    }

    pub async fn openstack_create_instance(&self, req: &CreateInstanceRequest) -> Result<serde_json::Value> {
        self.post_json_value("/api/v1/openstack/instances", &serde_json::to_value(req)?)
            .await
    }

    pub async fn openstack_delete_instance(&self, id: &str) -> Result<()> {
        self.delete_action(&format!("/api/v1/openstack/instances/{id}"))
            .await
    }

    pub async fn openstack_delete_image(&self, id: &str) -> Result<()> {
        self.delete_action(&format!("/api/v1/openstack/images/{id}"))
            .await
    }

    pub async fn openstack_console_output(&self, id: &str, lines: Option<u32>) -> Result<String> {
        let suffix = lines
            .map(|n| format!("?lines={n}"))
            .unwrap_or_default();
        #[derive(serde::Deserialize)]
        struct R {
            output: String,
        }
        let r: R = self
            .get_json(&format!(
                "/api/v1/openstack/instances/{id}/console-output{suffix}"
            ))
            .await?;
        Ok(r.output)
    }

    pub async fn openstack_remote_console(
        &self,
        id: &str,
        console_type: &str,
    ) -> Result<OpenStackRemoteConsole> {
        self.get_json(&format!(
            "/api/v1/openstack/instances/{id}/console?type={console_type}"
        ))
        .await
    }

    pub async fn openstack_export_instance(
        &self,
        id: &str,
        body: &serde_json::Value,
    ) -> Result<serde_json::Value> {
        self.post_json_value(
            &format!("/api/v1/openstack/instances/{id}/export"),
            body,
        )
        .await
    }

    pub async fn openstack_list_json(&self, resource: &str) -> Result<serde_json::Value> {
        self.get_json(&format!("/api/v1/openstack/{resource}")).await
    }

    pub async fn openstack_api_get(&self, path: &str) -> Result<serde_json::Value> {
        self.get_json(&format!("/api/v1/openstack/{path}")).await
    }

    pub async fn openstack_list_cinder_volumes(&self) -> Result<Vec<OpenStackAttachedVolume>> {
        #[derive(serde::Deserialize)]
        struct R {
            volumes: Vec<OpenStackAttachedVolume>,
        }
        let r: R = self.get_json("/api/v1/openstack/volumes").await?;
        Ok(r.volumes)
    }

    pub async fn openstack_list_instance_volumes(
        &self,
        id: &str,
    ) -> Result<Vec<OpenStackAttachedVolume>> {
        #[derive(serde::Deserialize)]
        struct R {
            volumes: Vec<OpenStackAttachedVolume>,
        }
        let r: R = self
            .get_json(&format!("/api/v1/openstack/instances/{id}/volumes"))
            .await?;
        Ok(r.volumes)
    }

    pub async fn openstack_attach_volume(&self, instance_id: &str, volume_id: &str) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/instances/{instance_id}/volumes/attach"),
            &AttachVolumeRequest {
                volume_id: volume_id.to_string(),
            },
        )
        .await
    }

    pub async fn openstack_detach_volume(&self, instance_id: &str, volume_id: &str) -> Result<()> {
        self.delete_action(&format!(
            "/api/v1/openstack/instances/{instance_id}/volumes/{volume_id}"
        ))
        .await
    }

    pub async fn openstack_list_floating_ips(&self) -> Result<Vec<OpenStackFloatingIp>> {
        #[derive(serde::Deserialize)]
        struct R {
            floating_ips: Vec<OpenStackFloatingIp>,
        }
        let r: R = self.get_json("/api/v1/openstack/floating-ips").await?;
        Ok(r.floating_ips)
    }

    pub async fn openstack_list_instance_floating_ips(
        &self,
        id: &str,
    ) -> Result<Vec<OpenStackFloatingIp>> {
        #[derive(serde::Deserialize)]
        struct R {
            floating_ips: Vec<OpenStackFloatingIp>,
        }
        let r: R = self
            .get_json(&format!("/api/v1/openstack/instances/{id}/floating-ips"))
            .await?;
        Ok(r.floating_ips)
    }

    pub async fn openstack_associate_floating_ip(
        &self,
        instance_id: &str,
        body: &AssociateFloatingIpRequest,
    ) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/instances/{instance_id}/floating-ips"),
            body,
        )
        .await
    }

    pub async fn openstack_dissociate_floating_ip(&self, fip_id: &str) -> Result<()> {
        self.post_action(&format!("/api/v1/openstack/floating-ips/{fip_id}/dissociate"))
            .await
    }

    pub async fn openstack_allocate_floating_ip(&self, network_id: &str) -> Result<OpenStackFloatingIp> {
        let v = self
            .post_json_value(
                "/api/v1/openstack/floating-ips",
                &serde_json::json!({ "floating_network_id": network_id }),
            )
            .await?;
        Ok(serde_json::from_value(v["floating_ip"].clone())?)
    }

    pub async fn openstack_delete_floating_ip(&self, fip_id: &str) -> Result<()> {
        self.delete_action(&format!("/api/v1/openstack/floating-ips/{fip_id}"))
            .await
    }

    pub async fn openstack_rename_instance(&self, id: &str, name: &str) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/instances/{id}/rename"),
            &serde_json::json!({ "name": name }),
        )
        .await
    }

    pub async fn openstack_lock_instance(&self, id: &str) -> Result<()> {
        self.post_action(&format!("/api/v1/openstack/instances/{id}/lock")).await
    }

    pub async fn openstack_unlock_instance(&self, id: &str) -> Result<()> {
        self.post_action(&format!("/api/v1/openstack/instances/{id}/unlock")).await
    }

    pub async fn openstack_delete_port(&self, port_id: &str) -> Result<()> {
        self.delete_action(&format!("/api/v1/openstack/ports/{port_id}"))
            .await
    }

    pub async fn openstack_force_delete_instance(&self, id: &str) -> Result<()> {
        self.post_action(&format!("/api/v1/openstack/instances/{id}/force-delete"))
            .await
    }

    pub async fn openstack_delete_server_group(&self, id: &str) -> Result<()> {
        self.delete_action(&format!("/api/v1/openstack/server-groups/{id}"))
            .await
    }

    pub async fn openstack_create_volume_from_image(
        &self,
        image_id: &str,
        name: Option<&str>,
        size_gb: Option<u64>,
    ) -> Result<()> {
        let mut body = serde_json::json!({ "image_id": image_id });
        if let Some(n) = name {
            if !n.is_empty() {
                body["name"] = serde_json::json!(n);
            }
        }
        if let Some(sz) = size_gb {
            if sz > 0 {
                body["size_gb"] = serde_json::json!(sz);
            }
        }
        self.post_json_value("/api/v1/openstack/volumes/from-image", &body)
            .await?;
        Ok(())
    }

    pub async fn openstack_select_cloud(&self, cloud_name: &str) -> Result<()> {
        self.post_json(
            "/api/v1/openstack/cloud",
            &serde_json::json!({ "cloud_name": cloud_name }),
        )
        .await
    }

    pub async fn openstack_get_json(&self, path: &str) -> Result<serde_json::Value> {
        self.get_json(&format!("/api/v1/openstack/{path}")).await
    }

    pub async fn openstack_add_security_group(&self, instance_id: &str, name: &str) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/instances/{instance_id}/security-groups"),
            &serde_json::json!({ "name": name }),
        )
        .await
    }

    pub async fn openstack_remove_security_group(&self, instance_id: &str, name: &str) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/instances/{instance_id}/security-groups/remove"),
            &serde_json::json!({ "name": name }),
        )
        .await
    }

    pub async fn openstack_migrate_instance(
        &self,
        id: &str,
        live: bool,
        host: Option<&str>,
    ) -> Result<()> {
        let mut body = serde_json::json!({ "live": live, "block_migration": false });
        if let Some(h) = host.filter(|s| !s.is_empty()) {
            body["host"] = serde_json::json!(h);
        }
        self.post_json(
            &format!("/api/v1/openstack/instances/{id}/migrate"),
            &body,
        )
        .await
    }

    pub async fn openstack_backup_instance(&self, id: &str, name: &str) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/instances/{id}/backup"),
            &serde_json::json!({ "name": name }),
        )
        .await
    }

    pub async fn openstack_rebuild_instance(&self, id: &str, image: &str) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/instances/{id}/rebuild"),
            &serde_json::json!({ "image": image }),
        )
        .await
    }

    pub async fn openstack_shelve_instance(&self, id: &str) -> Result<()> {
        self.post_json(&format!("/api/v1/openstack/instances/{id}/shelve"), &serde_json::json!({}))
            .await
    }

    pub async fn openstack_unshelve_instance(&self, id: &str) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/instances/{id}/unshelve"),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn openstack_rescue_instance(&self, id: &str, image: Option<&str>) -> Result<()> {
        let mut body = serde_json::json!({});
        if let Some(img) = image.filter(|s| !s.is_empty()) {
            body["image"] = serde_json::json!(img);
        }
        self.post_json(
            &format!("/api/v1/openstack/instances/{id}/rescue"),
            &body,
        )
        .await
    }

    pub async fn openstack_unrescue_instance(&self, id: &str) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/instances/{id}/unrescue"),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn openstack_list_instance_interfaces(&self, id: &str) -> Result<serde_json::Value> {
        self.get_json(&format!("/api/v1/openstack/instances/{id}/interfaces"))
            .await
    }

    pub async fn openstack_attach_interface(&self, id: &str, network_id: &str) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/instances/{id}/interfaces"),
            &serde_json::json!({ "network_id": network_id }),
        )
        .await
    }

    pub async fn openstack_detach_interface(&self, instance_id: &str, port_id: &str) -> Result<()> {
        self.delete_action(&format!(
            "/api/v1/openstack/instances/{instance_id}/interfaces/{port_id}"
        ))
        .await
    }

    pub async fn openstack_upload_volume_image(&self, volume_id: &str, image_name: &str) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/volumes/{volume_id}/upload-image"),
            &serde_json::json!({ "image_name": image_name }),
        )
        .await
    }

    pub async fn openstack_update_subnet(
        &self,
        subnet_id: &str,
        field: &str,
        value: &str,
    ) -> Result<()> {
        let mut body = serde_json::Map::new();
        match field {
            "name" => {
                body.insert("name".into(), serde_json::json!(value));
            }
            "gateway" | "gateway_ip" => {
                body.insert("gateway_ip".into(), serde_json::json!(value));
            }
            "dhcp" | "enable_dhcp" => {
                let on = matches!(value.to_lowercase().as_str(), "1" | "true" | "yes" | "on");
                body.insert("enable_dhcp".into(), serde_json::json!(on));
            }
            _ => anyhow::bail!("subnet field must be name, gateway, or dhcp"),
        }
        self.put_json(
            &format!("/api/v1/openstack/subnets/{subnet_id}"),
            &serde_json::Value::Object(body),
        )
        .await
    }

    pub async fn openstack_update_port(
        &self,
        port_id: &str,
        field: &str,
        value: &str,
    ) -> Result<()> {
        let mut body = serde_json::Map::new();
        match field {
            "name" => {
                body.insert("name".into(), serde_json::json!(value));
            }
            "admin" | "admin_state_up" | "admin_up" => {
                let on = matches!(value.to_lowercase().as_str(), "1" | "true" | "yes" | "on" | "up");
                body.insert("admin_state_up".into(), serde_json::json!(on));
            }
            _ => anyhow::bail!("port field must be name or admin"),
        }
        self.put_json(
            &format!("/api/v1/openstack/ports/{port_id}"),
            &serde_json::Value::Object(body),
        )
        .await
    }

    pub async fn openstack_create_flavor(
        &self,
        name: &str,
        vcpus: u32,
        ram_mb: u64,
        disk_gb: u64,
    ) -> Result<()> {
        self.post_json(
            "/api/v1/openstack/flavors",
            &serde_json::json!({
                "name": name,
                "vcpus": vcpus,
                "ram_mb": ram_mb,
                "disk_gb": disk_gb,
                "is_public": true,
            }),
        )
        .await
    }

    pub async fn openstack_delete_flavor(&self, flavor_id: &str) -> Result<()> {
        self.delete_action(&format!("/api/v1/openstack/flavors/{flavor_id}"))
            .await
    }

    pub async fn openstack_update_quotas(
        &self,
        service: &str,
        key: &str,
        limit: i64,
    ) -> Result<()> {
        let mut quotas = serde_json::Map::new();
        quotas.insert(key.into(), serde_json::json!(limit));
        self.put_json(
            "/api/v1/openstack/quotas",
            &serde_json::json!({ "service": service, "quotas": quotas }),
        )
        .await
    }

    pub async fn openstack_set_compute_service(
        &self,
        binary: &str,
        host: &str,
        enable: bool,
    ) -> Result<()> {
        let path = if enable {
            "enable"
        } else {
            "disable"
        };
        self.post_json(
            &format!("/api/v1/openstack/compute-services/{path}"),
            &serde_json::json!({ "binary": binary, "host": host, "disabled": !enable }),
        )
        .await
    }

    pub async fn openstack_set_agent_admin(&self, agent_id: &str, up: bool) -> Result<()> {
        self.put_json(
            &format!("/api/v1/openstack/neutron-agents/{agent_id}"),
            &serde_json::json!({ "admin_state_up": up }),
        )
        .await
    }

    pub async fn openstack_set_hv_maintenance(&self, hv_id: &str, on: bool) -> Result<()> {
        self.put_json(
            &format!("/api/v1/openstack/hypervisors/{hv_id}"),
            &serde_json::json!({ "maintenance": on }),
        )
        .await
    }

    pub async fn openstack_create_aggregate(&self, name: &str, az: Option<&str>) -> Result<()> {
        let mut body = serde_json::json!({ "name": name });
        if let Some(z) = az.filter(|s| !s.is_empty()) {
            body["availability_zone"] = serde_json::json!(z);
        }
        self.post_json("/api/v1/openstack/aggregates", &body).await
    }

    pub async fn openstack_aggregate_add_host(&self, agg_id: &str, host: &str) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/aggregates/{agg_id}/add-host"),
            &serde_json::json!({ "host": host }),
        )
        .await
    }

    pub async fn openstack_aggregate_remove_host(&self, agg_id: &str, host: &str) -> Result<()> {
        self.post_json(
            &format!("/api/v1/openstack/aggregates/{agg_id}/remove-host"),
            &serde_json::json!({ "host": host }),
        )
        .await
    }

    pub async fn kubevirt_cluster_exec(
        &self,
        vm: &str,
        op: &str,
        body: &serde_json::Value,
    ) -> Result<serde_json::Value> {
        let path = match op {
            "apply" => "apply",
            "upload" => "upload",
            "start" => "start",
            _ => anyhow::bail!("unknown kubevirt op '{op}' (expected apply, upload, start)"),
        };
        let url = format!("{}/api/v1/vms/{}/kubevirt/{}", self.base_url, vm, path);
        let resp = self.client.post(&url).json(body).send().await?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(Self::http_error(status, &text));
        }
        serde_json::from_str(&text)
            .map_err(|e| anyhow::anyhow!("invalid JSON from daemon: {e}; body: {text}"))
    }
}
