// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

//! Domain graphics via `virt-xml` (Cockpit Machines parity).
//!
//! `virt-xml` has mutually exclusive action modes: `--edit`, `--add-device`, and
//! `--remove-device` must not be combined. See `VirtXmlAction`.

use std::process::Command;

use crate::LibvirtError;

/// `virt-xml` action mode (only one per invocation).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VirtXmlAction {
    Edit,
    AddDevice,
    RemoveDevice,
}

/// Build argv for a `virt-xml` invocation (testable without running the binary).
fn virt_xml_argv(uri: &str, vm_name: &str, action: VirtXmlAction, args: &[&str]) -> Vec<String> {
    let mut argv = vec!["-c".to_string(), uri.to_string(), vm_name.to_string()];
    if action == VirtXmlAction::Edit {
        argv.push("--edit".to_string());
    }
    argv.extend(args.iter().map(|s| (*s).to_string()));
    argv
}

fn run_virt_xml(
    uri: &str,
    vm_name: &str,
    action: VirtXmlAction,
    args: &[&str],
) -> Result<String, LibvirtError> {
    let argv = virt_xml_argv(uri, vm_name, action, args);
    let mut cmd = Command::new("virt-xml");
    for a in &argv {
        cmd.arg(a);
    }
    let out = cmd
        .output()
        .map_err(|e| LibvirtError::Operation(format!("virt-xml spawn failed: {e}")))?;
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    Err(LibvirtError::Operation(format!(
        "virt-xml failed: {stderr}"
    )))
}

/// Emit one or two `<graphics/>` elements for domain XML templates.
pub fn graphics_elements_xml(listen: &str, graphics_type: &str) -> String {
    let listen_esc = crate::xml::escape(listen);
    let gt = graphics_type.trim().to_ascii_lowercase();
    let want_vnc = gt == "vnc" || gt == "both";
    let want_spice = gt == "spice" || gt == "both";
    let mut out = Vec::new();
    if want_vnc {
        out.push(format!(
            "<graphics type='vnc' port='-1' autoport='yes' listen='{listen_esc}'/>"
        ));
    }
    if want_spice {
        if super::create::has_spice() {
            out.push(format!(
                "<graphics type='spice' port='-1' autoport='yes' listen='{listen_esc}'/>"
            ));
        } else if !want_vnc {
            out.push(format!(
                "<graphics type='vnc' port='-1' autoport='yes' listen='{listen_esc}'/>"
            ));
        }
    }
    if out.is_empty() {
        out.push(format!(
            "<graphics type='vnc' port='-1' autoport='yes' listen='{listen_esc}'/>"
        ));
    }
    out.join("\n    ")
}

/// True when active or inactive domain XML contains a SPICE graphics device.
pub fn domain_has_spice_graphics(xml: &str) -> bool {
    for block in crate::xml::split_blocks(xml, "graphics") {
        if crate::xml::extract_attr(&block, "graphics", "type").as_deref() == Some("spice") {
            return true;
        }
    }
    false
}

pub fn virt_xml_convert_spice_to_vnc(
    libvirt_uri: &str,
    vm_name: &str,
) -> Result<String, LibvirtError> {
    run_virt_xml(
        libvirt_uri,
        vm_name,
        VirtXmlAction::Edit,
        &["--convert-to-vnc"],
    )
}

pub fn virt_xml_add_graphics(
    libvirt_uri: &str,
    vm_name: &str,
    graphics_type: &str,
    listen: &str,
) -> Result<String, LibvirtError> {
    let graphics_type = graphics_type.trim().to_ascii_lowercase();
    crate::validate::validate_graphics_kind(&graphics_type)?;
    crate::validate::validate_graphics_listen(listen)?;
    // `port=-1` already makes libvirt allocate a port automatically (autoport='yes' in
    // the resulting XML). Do NOT also pass `autoport=yes`: it is not a valid --graphics
    // suboption in virt-install/virt-xml 4.x (accepts type/listen/port/tlsPort/address.*)
    // and makes the whole command fail with "Unknown --graphics options: ['autoport']",
    // which breaks VM create whenever a second graphics device is added.
    let spec = format!("type={graphics_type},listen={listen},port=-1");
    run_virt_xml(
        libvirt_uri,
        vm_name,
        VirtXmlAction::AddDevice,
        &["--add-device", "--graphics", &spec],
    )
}

pub fn virt_xml_remove_graphics(
    libvirt_uri: &str,
    vm_name: &str,
    graphics_type: &str,
) -> Result<String, LibvirtError> {
    let graphics_type = graphics_type.trim().to_ascii_lowercase();
    crate::validate::validate_graphics_kind(&graphics_type)?;
    let spec = format!("type={graphics_type}");
    run_virt_xml(
        libvirt_uri,
        vm_name,
        VirtXmlAction::RemoveDevice,
        &["--remove-device", "--graphics", &spec],
    )
}

#[cfg(test)]
mod tests {
    use super::{virt_xml_argv, VirtXmlAction};

    #[test]
    fn convert_to_vnc_uses_edit_mode() {
        let argv = virt_xml_argv(
            "qemu:///system",
            "vm1",
            VirtXmlAction::Edit,
            &["--convert-to-vnc"],
        );
        assert_eq!(
            argv,
            vec![
                "-c",
                "qemu:///system",
                "vm1",
                "--edit",
                "--convert-to-vnc",
            ]
        );
    }

    #[test]
    fn add_graphics_omits_edit() {
        let argv = virt_xml_argv(
            "qemu:///system",
            "vm1",
            VirtXmlAction::AddDevice,
            &[
                "--add-device",
                "--graphics",
                "type=spice,listen=127.0.0.1,port=-1",
            ],
        );
        assert!(!argv.contains(&"--edit".to_string()));
        assert_eq!(argv[3], "--add-device");
    }

    #[test]
    fn remove_graphics_omits_edit() {
        let argv = virt_xml_argv(
            "qemu:///system",
            "vm1",
            VirtXmlAction::RemoveDevice,
            &["--remove-device", "--graphics", "type=vnc"],
        );
        assert!(!argv.contains(&"--edit".to_string()));
        assert_eq!(argv[3], "--remove-device");
    }

    #[test]
    fn domain_has_spice_graphics_detects_spice() {
        let xml = "<domain><graphics type='spice' listen='127.0.0.1'/></domain>";
        assert!(super::domain_has_spice_graphics(xml));
        assert!(!super::domain_has_spice_graphics(
            "<domain><graphics type='vnc' listen='127.0.0.1'/></domain>"
        ));
    }
}
