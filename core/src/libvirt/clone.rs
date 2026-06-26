// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

use std::path::Path;

use virt::connect::Connect;
use virt::domain::Domain;

use super::create::find_disk_path;
use super::domain::lookup_domain;
use super::template_apply::{materialize_from_base, primary_disk_path_from_xml};
use crate::LibvirtError;

/// `linked` — qcow2 backing file; `full` — independent copy; `xml` — legacy shared-disk define (unsafe).
pub fn normalize_clone_disk_mode(mode: &str) -> &'static str {
    match mode.trim().to_lowercase().as_str() {
        "full" | "copy" => "copy",
        "xml" | "shared" => "xml",
        _ => "backing",
    }
}

/// Clone a VM with independent or linked disks. Returns the new domain UUID.
pub fn clone_vm_with_disk(
    conn: &Connect,
    source_name: &str,
    new_name: &str,
    disk_mode: &str,
) -> Result<String, LibvirtError> {
    crate::validate::validate_name(new_name)?;
    let mode = normalize_clone_disk_mode(disk_mode);

    if mode == "xml" {
        clone_vm_xml_only(conn, source_name, new_name)?;
    } else {
        let source = lookup_domain(conn, source_name)?;
        let xml = source
            .get_xml_desc(0)
            .map_err(LibvirtError::map_op("Failed to get XML"))?;
        let src_disk = primary_disk_path_from_xml(&xml).ok_or_else(|| {
            LibvirtError::Operation(format!("no disk path found for VM '{source_name}'"))
        })?;
        if !src_disk.is_file() {
            return Err(LibvirtError::Operation(format!(
                "source disk not found: {}",
                src_disk.display()
            )));
        }
        let dest = find_disk_path(conn, new_name)?;
        if Path::new(&dest).exists() {
            return Err(LibvirtError::Operation(format!(
                "Refusing to overwrite existing disk: {dest}"
            )));
        }
        let mat_mode = if mode == "copy" { "copy" } else { "backing" };
        materialize_from_base(&src_disk, Path::new(&dest), mat_mode)?;
        define_cloned_domain(conn, &xml, new_name, &dest)?;
    }

    let dom = lookup_domain(conn, new_name)?;
    dom.get_uuid_string()
        .map_err(LibvirtError::map_op("Failed to get cloned VM UUID"))
}

/// Legacy XML-only clone (shared disk paths). Prefer [`clone_vm_with_disk`].
pub fn clone_vm(conn: &Connect, source_name: &str, new_name: &str) -> Result<(), LibvirtError> {
    clone_vm_xml_only(conn, source_name, new_name)
}

fn clone_vm_xml_only(
    conn: &Connect,
    source_name: &str,
    new_name: &str,
) -> Result<(), LibvirtError> {
    crate::validate::validate_name(new_name)?;
    let source = lookup_domain(conn, source_name)?;
    let xml = source
        .get_xml_desc(0)
        .map_err(LibvirtError::map_op("Failed to get XML"))?;
    let new_xml = replace_domain_name(&xml, new_name).ok_or_else(|| {
        LibvirtError::Operation(
            "Failed to replace VM name in XML: <name> element not found".to_string(),
        )
    })?;
    let new_xml = remove_xml_element(&new_xml, "uuid");
    let new_xml = randomize_mac_addresses(&new_xml);
    Domain::define_xml(conn, &new_xml)
        .map_err(LibvirtError::map_op("Failed to define cloned VM"))?;
    Ok(())
}

fn define_cloned_domain(
    conn: &Connect,
    source_xml: &str,
    new_name: &str,
    new_disk_path: &str,
) -> Result<(), LibvirtError> {
    let new_xml = replace_domain_name(source_xml, new_name)
        .ok_or_else(|| LibvirtError::Operation("failed to replace domain name in XML".into()))?;
    let new_xml = remove_xml_element(&new_xml, "uuid");
    let new_xml = randomize_mac_addresses(&new_xml);
    let new_xml = replace_disk_path(&new_xml, new_disk_path);
    Domain::define_xml(conn, &new_xml)
        .map_err(|e| LibvirtError::Operation(format!("define cloned VM: {e}")))?;
    Ok(())
}

fn replace_disk_path(xml: &str, new_path: &str) -> String {
    let escaped = crate::xml::escape(new_path);
    let mut out = String::new();
    let mut replaced = false;
    for line in xml.lines() {
        let t = line.trim();
        if !replaced && t.starts_with("<source file='") {
            let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
            out.push_str(&format!("{indent}<source file='{escaped}'/>\n"));
            replaced = true;
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

fn replace_domain_name(xml: &str, new_name: &str) -> Option<String> {
    let start = xml.find("<name>")?;
    let end = xml.find("</name>")?;
    let before = &xml[..start];
    let after = &xml[end + "</name>".len()..];
    Some(format!(
        "{before}<name>{}</name>{after}",
        crate::xml::escape(new_name)
    ))
}

fn remove_xml_element(xml: &str, tag: &str) -> String {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    if let Some(start) = xml.find(&open) {
        if let Some(end_offset) = xml[start..].find(&close) {
            let end = start + end_offset + close.len();
            let after = &xml[end..];
            let trim_end = after.len() - after.trim_start().len();
            let mut result = xml[..start].to_string();
            result.push_str(&xml[end + trim_end..]);
            return result;
        }
    }
    xml.to_string()
}

fn randomize_mac_addresses(xml: &str) -> String {
    let mut result = String::new();
    let mut remaining = xml;
    let mut counter: u64 = 0;

    while let Some(pos) = remaining.find("<mac ") {
        result.push_str(&remaining[..pos]);
        let tag_start = &remaining[pos..];
        if let Some(end) = tag_start.find("/>") {
            let new_mac = generate_mac(counter);
            counter += 1;
            result.push_str(&format!("<mac address='{new_mac}'/>"));
            remaining = &remaining[pos + end + 2..];
        } else if let Some(end) = tag_start.find('>') {
            let new_mac = generate_mac(counter);
            counter += 1;
            result.push_str(&format!("<mac address='{new_mac}'/>"));
            remaining = &remaining[pos + end + 1..];
        } else {
            result.push_str(tag_start);
            remaining = "";
        }
    }
    result.push_str(remaining);
    result
}

fn generate_mac(counter: u64) -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let s1 = RandomState::new();
    let s2 = RandomState::new();
    let mut h1 = s1.build_hasher();
    let mut h2 = s2.build_hasher();
    h1.write_u64(counter);
    h2.write_u64(counter.wrapping_add(1));
    let hash1 = h1.finish();
    let hash2 = h2.finish();
    let b1 = hash1.to_le_bytes();
    let b2 = hash2.to_le_bytes();
    format!(
        "52:54:00:{:02x}:{:02x}:{:02x}",
        b1[0] ^ b2[1],
        b1[2] ^ b2[3],
        b1[4] ^ b2[5]
    )
}
