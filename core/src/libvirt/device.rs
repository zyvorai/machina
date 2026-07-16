// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

use virt::connect::Connect;
use virt::domain::Domain;

use super::domain::lookup_domain;
use crate::state::AttachDiskRequest;
use crate::LibvirtError;

pub fn get_domain_flags_pub(domain: &Domain) -> u32 {
    get_domain_flags(domain)
}

pub(crate) fn get_domain_flags(domain: &Domain) -> u32 {
    domain
        .get_info()
        .map(|info| {
            if info.state == 1
            /* VIR_DOMAIN_RUNNING */
            {
                virt::sys::VIR_DOMAIN_AFFECT_LIVE | virt::sys::VIR_DOMAIN_AFFECT_CONFIG
            } else {
                virt::sys::VIR_DOMAIN_AFFECT_CONFIG
            }
        })
        .unwrap_or(virt::sys::VIR_DOMAIN_AFFECT_CONFIG)
}

const DISK_BUSES: &[&str] = &["virtio", "scsi", "sata", "ide"];

pub fn attach_disk(
    conn: &Connect,
    vm_name: &str,
    req: &AttachDiskRequest,
) -> Result<(), LibvirtError> {
    let source_path = std::path::Path::new(&req.source);
    if !source_path.is_absolute() {
        return Err(LibvirtError::Invalid(
            "Disk source path must be absolute".to_string(),
        ));
    }
    // Canonicalize to resolve symlinks and prevent path traversal
    let resolved = source_path
        .canonicalize()
        .map_err(|_| LibvirtError::Operation(format!("Disk source not found: {}", req.source)))?;
    if !resolved.is_file() {
        return Err(LibvirtError::Operation(format!(
            "Disk source is not a file: {}",
            req.source
        )));
    }
    // Confine to a configured pool so a caller can't attach an arbitrary host file/block
    // device into a guest. Check the CANONICAL path (symlinks already resolved).
    let resolved_str = resolved.to_string_lossy().into_owned();
    super::storage::assert_backup_source_within_pools(conn, &resolved_str)?;

    let bus = req.bus.trim();
    let bus = if bus.is_empty() { "virtio" } else { bus };
    if !DISK_BUSES.contains(&bus) {
        return Err(LibvirtError::Invalid(format!(
            "Invalid disk bus '{}'. Allowed: {}",
            bus,
            DISK_BUSES.join(", ")
        )));
    }
    let cache = req.cache.trim();
    let discard = req.discard.trim();
    let mut driver_attrs = vec![
        "name='qemu'".to_string(),
        format!("type='{}'", crate::xml::escape(&req.driver)),
    ];
    if !cache.is_empty() {
        driver_attrs.push(format!("cache='{}'", crate::xml::escape(cache)));
    }
    if !discard.is_empty() {
        driver_attrs.push(format!("discard='{}'", crate::xml::escape(discard)));
    }
    let driver_xml = format!("<driver {} />", driver_attrs.join(" "));
    let ro = if req.readonly { "\n  <readonly/>" } else { "" };
    let share = if req.shareable {
        " shareable='yes'"
    } else {
        ""
    };

    let domain = lookup_domain(conn, vm_name)?;

    let xml = format!(
        r#"<disk type='file' device='disk'{share}>
  {driver_xml}
  <source file='{source}'/>
  <target dev='{target}' bus='{bus}'/>{ro}
</disk>"#,
        share = share,
        driver_xml = driver_xml,
        source = crate::xml::escape(&resolved_str),
        target = crate::xml::escape(&req.target),
        bus = crate::xml::escape(bus),
        ro = ro,
    );

    let flags = get_domain_flags(&domain);
    domain
        .attach_device_flags(&xml, flags)
        .map_err(LibvirtError::map_op("Failed to attach disk"))?;
    Ok(())
}

pub fn detach_disk(conn: &Connect, vm_name: &str, target: &str) -> Result<(), LibvirtError> {
    let domain = lookup_domain(conn, vm_name)?;

    let xml = format!(
        r#"<disk type='file' device='disk'>
  <target dev='{}'/>
</disk>"#,
        crate::xml::escape(target),
    );

    let flags = get_domain_flags(&domain);
    domain
        .detach_device_flags(&xml, flags)
        .map_err(|e| LibvirtError::Operation(format!("Failed to detach disk '{target}': {e}")))?;
    Ok(())
}

/// Resize a block device attached to a VM (in GB).
/// Note: size_bytes = size_gb * 1024^3, max 10240 GB = ~11 TB, fits in u64.
pub fn resize_block_device(
    conn: &Connect,
    vm_name: &str,
    target: &str,
    size_gb: u64,
) -> Result<(), LibvirtError> {
    crate::validate::validate_disk_gb(size_gb)?;
    let domain = lookup_domain(conn, vm_name)?;
    let size_bytes = size_gb * 1024 * 1024 * 1024;
    domain.block_resize(target, size_bytes, 0).map_err(|e| {
        LibvirtError::Operation(format!(
            "Failed to resize disk '{target}' on '{}': {e}",
            vm_name
        ))
    })?;
    Ok(())
}

const ALLOWED_NIC_MODELS: &[&str] = &["virtio", "e1000", "e1000e", "rtl8139", "vmxnet3"];

/// Attach a network interface to a VM.
pub fn attach_interface(
    conn: &Connect,
    vm_name: &str,
    network: &str,
    model: &str,
) -> Result<(), LibvirtError> {
    crate::validate::validate_name(network)?;
    if !ALLOWED_NIC_MODELS.contains(&model) {
        return Err(LibvirtError::Invalid(format!(
            "Invalid NIC model '{}'. Allowed: {}",
            model,
            ALLOWED_NIC_MODELS.join(", ")
        )));
    }
    let domain = lookup_domain(conn, vm_name)?;

    let xml = format!(
        r#"<interface type='network'>
  <source network='{network}'/>
  <model type='{model}'/>
</interface>"#,
        network = crate::xml::escape(network),
        model = crate::xml::escape(model),
    );

    let flags = get_domain_flags(&domain);
    domain
        .attach_device_flags(&xml, flags)
        .map_err(LibvirtError::map_op("Failed to attach network interface"))?;
    Ok(())
}

/// Detach a network interface from a VM by MAC address.
pub fn detach_interface(conn: &Connect, vm_name: &str, mac: &str) -> Result<(), LibvirtError> {
    // Validate MAC address format (xx:xx:xx:xx:xx:xx)
    let parts: Vec<&str> = mac.split(':').collect();
    if parts.len() != 6
        || !parts
            .iter()
            .all(|p| p.len() == 2 && p.chars().all(|c| c.is_ascii_hexdigit()))
    {
        return Err(LibvirtError::Invalid(format!(
            "Invalid MAC address format: '{mac}'"
        )));
    }

    let domain = lookup_domain(conn, vm_name)?;

    // Extract the full <interface> XML from the running domain — libvirt requires the
    // <source> element to be present for type='network' interfaces, so passing just
    // <mac address='...'/> results in "XML error: interface type='network' requires a
    // 'source' element". Using the exact XML from the domain ensures all required fields
    // are present.
    let domain_xml = domain
        .get_xml_desc(0)
        .map_err(LibvirtError::map_op("Failed to get domain XML for NIC detach"))?;
    let xml = extract_interface_xml_by_mac(&domain_xml, mac).ok_or_else(|| {
        LibvirtError::NotFound(format!("Interface with MAC '{mac}' not found in domain XML"))
    })?;

    let flags = get_domain_flags(&domain);
    domain
        .detach_device_flags(&xml, flags)
        .map_err(|e| LibvirtError::Operation(format!("Failed to detach interface '{mac}': {e}")))?;
    Ok(())
}

/// Extract the `<interface>…</interface>` block containing the given MAC address.
fn extract_interface_xml_by_mac(domain_xml: &str, mac: &str) -> Option<String> {
    let mac_lower = mac.to_ascii_lowercase();
    let lower = domain_xml.to_ascii_lowercase();
    // Try both single-quote and double-quote attribute styles
    for q in [('\'', '\''), ('"', '"')] {
        let needle = format!("address={}{}{}", q.0, mac_lower, q.1);
        if let Some(mac_pos) = lower.find(&needle) {
            // Walk backwards to the opening <interface tag
            if let Some(iface_off) = lower[..mac_pos].rfind("<interface") {
                // Walk forwards to the closing </interface>
                let suffix = &lower[iface_off..];
                if let Some(close_off) = suffix.find("</interface>") {
                    let end = iface_off + close_off + "</interface>".len();
                    return Some(domain_xml[iface_off..end].to_string());
                }
            }
        }
    }
    None
}
