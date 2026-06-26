// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

use virt::connect::Connect;

use super::domain::lookup_domain;
use crate::LibvirtError;

#[allow(clippy::too_many_lines)]
pub fn insert_cdrom(
    conn: &Connect,
    name: &str,
    iso_path: &str,
    target: &str,
) -> Result<(), LibvirtError> {
    let domain = lookup_domain(conn, name)?;
    let conn_ref = conn;

    // Validate ISO path: must be absolute and resolve to a real path (no symlink escapes)
    let path = std::path::Path::new(iso_path);
    if !path.is_absolute() {
        return Err(LibvirtError::Invalid(
            "ISO path must be absolute".to_string(),
        ));
    }
    if !path.exists() {
        return Err(LibvirtError::Operation(format!(
            "ISO file not found: {iso_path}"
        )));
    }
    let resolved = path
        .canonicalize()
        .map_err(|_| LibvirtError::Operation(format!("Failed to resolve ISO path: {iso_path}")))?;
    if !resolved.is_file() {
        return Err(LibvirtError::Operation(format!(
            "ISO path is not a file: {iso_path}"
        )));
    }

    let flags = get_update_flags(&domain);

    // Check if a cdrom device already exists at this target
    let vm_xml = domain.get_xml_desc(0).unwrap_or_default();
    let (has_cdrom, existing_bus) = find_cdrom_device(&vm_xml, target);

    if has_cdrom {
        // Update existing cdrom device — use same bus type
        let bus = existing_bus.unwrap_or_else(|| "sata".to_string());
        let xml = format!(
            r#"<disk type='file' device='cdrom'>
  <driver name='qemu' type='raw'/>
  <source file='{}'/>
  <target dev='{}' bus='{}'/>
  <readonly/>
</disk>"#,
            crate::xml::escape(iso_path),
            crate::xml::escape(target),
            crate::xml::escape(&bus),
        );
        domain
            .update_device_flags(&xml, flags)
            .map_err(|e| LibvirtError::Operation(format!("Failed to update CD-ROM: {e}")))?;
    } else {
        // No cdrom exists — attach new device. Detect bus type from VM.
        let bus = detect_best_bus(&vm_xml);
        let xml = format!(
            r#"<disk type='file' device='cdrom'>
  <driver name='qemu' type='raw'/>
  <source file='{}'/>
  <target dev='{}' bus='{}'/>
  <readonly/>
</disk>"#,
            crate::xml::escape(iso_path),
            crate::xml::escape(target),
            bus,
        );

        // For shutoff VMs, we can redefine with the cdrom; for running VMs, use attach
        let info = domain.get_info().ok();
        let is_running = info.as_ref().map(|i| i.state == 1).unwrap_or(false);

        if is_running {
            // Try live+config first. SATA can't be hotplugged — fall back to config-only
            // so the drive appears on next boot without failing the whole operation.
            let live_result = domain.attach_device_flags(
                &xml,
                virt::sys::VIR_DOMAIN_AFFECT_LIVE | virt::sys::VIR_DOMAIN_AFFECT_CONFIG,
            );
            if live_result.is_err() {
                domain
                    .attach_device_flags(&xml, virt::sys::VIR_DOMAIN_AFFECT_CONFIG)
                    .map_err(|e| {
                        LibvirtError::Operation(format!(
                            "Failed to attach CD-ROM (stop the VM to hot-attach SATA): {e}"
                        ))
                    })?;
            }
        } else {
            // For shutoff VMs — insert cdrom into XML definition
            let new_xml = insert_cdrom_into_xml(&vm_xml, &xml);
            virt::domain::Domain::define_xml(conn_ref, &new_xml).map_err(|e| {
                LibvirtError::Operation(format!("Failed to define VM with CD-ROM: {e}"))
            })?;
        }
    }

    Ok(())
}

pub fn eject_cdrom(conn: &Connect, name: &str, target: &str) -> Result<(), LibvirtError> {
    let domain = lookup_domain(conn, name)?;
    let vm_xml = domain.get_xml_desc(0).unwrap_or_default();
    let (has_cdrom, existing_bus) = find_cdrom_device(&vm_xml, target);

    if !has_cdrom {
        return Err(LibvirtError::NotFound(format!(
            "No CD-ROM device at target '{target}'"
        )));
    }

    let bus = existing_bus.unwrap_or_else(|| "sata".to_string());
    let xml = format!(
        r#"<disk type='file' device='cdrom'>
  <target dev='{}' bus='{}'/>
  <readonly/>
</disk>"#,
        crate::xml::escape(target),
        crate::xml::escape(&bus),
    );

    let flags = get_update_flags(&domain);
    domain
        .update_device_flags(&xml, flags)
        .map_err(|e| LibvirtError::Operation(format!("Failed to eject CD-ROM: {e}")))?;

    Ok(())
}

/// Find a cdrom device at the given target, return (exists, bus_type).
fn find_cdrom_device(xml: &str, target: &str) -> (bool, Option<String>) {
    for block in crate::xml::split_blocks(xml, "disk") {
        let device = crate::xml::extract_attr(&block, "disk", "device").unwrap_or_default();
        if device == "cdrom" {
            let dev = crate::xml::extract_attr(&block, "target", "dev").unwrap_or_default();
            if dev == target || target.is_empty() {
                let bus = crate::xml::extract_attr(&block, "target", "bus");
                return (true, bus);
            }
        }
    }
    (false, None)
}

/// Detect the best bus type for a new cdrom based on VM's existing controllers.
fn detect_best_bus(xml: &str) -> &'static str {
    // Check for SATA controller
    if xml.contains("type='sata'") || xml.contains("type=\"sata\"") {
        return "sata";
    }
    // Check for SCSI controller
    if xml.contains("type='scsi'") || xml.contains("type=\"scsi\"") {
        return "scsi";
    }
    // Check for IDE controller (legacy)
    if xml.contains("type='ide'") || xml.contains("type=\"ide\"") {
        return "ide";
    }
    // Default: SATA works on q35 machines (most modern VMs)
    "sata"
}

/// Insert a cdrom disk XML into the VM's devices section.
fn insert_cdrom_into_xml(vm_xml: &str, cdrom_xml: &str) -> String {
    // Insert before </devices>
    if let Some(pos) = vm_xml.rfind("</devices>") {
        let mut result = vm_xml[..pos].to_string();
        result.push_str("    ");
        result.push_str(cdrom_xml);
        result.push('\n');
        result.push_str("  ");
        result.push_str(&vm_xml[pos..]);
        result
    } else {
        vm_xml.to_string()
    }
}

fn get_update_flags(domain: &virt::domain::Domain) -> u32 {
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
