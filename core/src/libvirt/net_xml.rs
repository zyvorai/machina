// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Extract networking hints from libvirt XML snippets (domain / network definitions).

use std::collections::HashSet;

/// First `<ip address='v4' …>` on an IPv4-looking address (typical libvirt NAT bridge IP on the host).
pub fn ipv4_gateway_from_network_xml(xml: &str) -> Option<String> {
    let mut start = 0usize;
    while let Some(rel) = xml.get(start..).and_then(|s| s.find("address='")) {
        let i = start + rel + "address='".len();
        let rest = xml.get(i..)?;
        let end = rest.find('\'')?;
        let addr = &rest[..end];
        if addr.contains('.') && addr.parse::<std::net::Ipv4Addr>().is_ok() {
            return Some(addr.to_string());
        }
        start = i + end;
    }
    None
}

/// `<source network='foo'/>` or `network="foo"` names referenced by a domain XML.
pub fn network_names_from_domain_xml(xml: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut start = 0usize;
    while let Some((name, next)) = next_network_source_name(xml, start) {
        if seen.insert(name.clone()) {
            out.push(name);
        }
        start = next;
    }
    out
}

fn next_network_source_name(xml: &str, start: usize) -> Option<(String, usize)> {
    let tail = xml.get(start..)?;
    let pos_sq = tail.find("network='");
    let pos_dq = tail.find("network=\"");
    let (rel, quote, key_len) = match (pos_sq, pos_dq) {
        (Some(a), Some(b)) => {
            if a <= b {
                (a, '\'', "network='".len())
            } else {
                (b, '"', "network=\"".len())
            }
        }
        (Some(a), None) => (a, '\'', "network='".len()),
        (None, Some(b)) => (b, '"', "network=\"".len()),
        (None, None) => return None,
    };
    let i = start + rel + key_len;
    let rest = xml.get(i..)?;
    let end = rest.find(quote)?;
    Some((rest[..end].to_string(), i + end + 1))
}

#[cfg(test)]
mod tests {
    use super::network_names_from_domain_xml;

    #[test]
    fn domain_xml_single_quoted_network_sources() {
        let xml = r#"<interface type='network'><source network='default'/></interface>"#;
        assert_eq!(
            network_names_from_domain_xml(xml),
            vec!["default".to_string()]
        );
    }

    #[test]
    fn domain_xml_double_quoted_network_sources() {
        let xml = r#"<interface type="network"><source network="default"/></interface>"#;
        assert_eq!(
            network_names_from_domain_xml(xml),
            vec!["default".to_string()]
        );
    }

    #[test]
    fn domain_xml_prefers_earliest_network_source() {
        let xml = concat!(
            r#"<interface type='network'><source network='net-a'/>"#,
            r#"<source network='net-b'/></interface>"#
        );
        assert_eq!(
            network_names_from_domain_xml(xml),
            vec!["net-a".to_string(), "net-b".to_string()]
        );
    }
}
