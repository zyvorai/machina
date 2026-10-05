// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

//! Cloud primitives with no host side effects. IPv4 first; reject unsupported
//! address families rather than silently provisioning a different network.
use std::net::Ipv4Addr;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CloudCidr {
    pub network: u32,
    pub prefix: u8,
}

impl FromStr for CloudCidr {
    type Err = String;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let (ip, prefix) = value.split_once('/').ok_or("CIDR prefix required")?;
        let ip: Ipv4Addr = ip.parse().map_err(|_| "IPv4 CIDR required")?;
        let prefix: u8 = prefix.parse().map_err(|_| "invalid prefix")?;
        if prefix > 32 {
            return Err("prefix must be 0..32".into());
        }
        let network = u32::from(ip);
        let mask = if prefix == 0 {
            0
        } else {
            u32::MAX << (32 - prefix)
        };
        if network & mask != network {
            return Err("CIDR must use its network address".into());
        }
        Ok(Self { network, prefix })
    }
}

impl CloudCidr {
    pub fn last(self) -> u32 {
        self.network
            | if self.prefix == 0 {
                u32::MAX
            } else {
                u32::MAX >> self.prefix
            }
    }
    pub fn contains(self, other: Self) -> bool {
        self.network <= other.network && self.last() >= other.last()
    }
    pub fn overlaps(self, other: Self) -> bool {
        self.network <= other.last() && other.network <= self.last()
    }
    pub fn address(self, offset: u32) -> Result<String, String> {
        let ip = self.network.checked_add(offset).ok_or("address overflow")?;
        if ip > self.last() {
            return Err("offset outside subnet".into());
        }
        Ok(Ipv4Addr::from(ip).to_string())
    }
    pub fn validate_private(self, subnet: bool) -> Result<(), String> {
        let private = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
            .iter()
            .any(|v| v.parse::<Self>().unwrap().contains(self));
        if !private || !(if subnet { 16..=28 } else { 8..=24 }).contains(&self.prefix) {
            return Err("use RFC1918 CIDR (/8../24 VPC, /16../28 subnet)".into());
        }
        Ok(())
    }
    /// Lower half is managed IPAM, upper half DHCP. Never allocate DHCP's range.
    pub fn ipam_end_offset(self) -> u32 {
        (self.last() - self.network).div_ceil(2) - 1
    }
}

/// Deterministic names are owned by a subnet UUID, never a user's display name.
pub fn cloud_network_xml(id: &str, cidr: &str) -> Result<String, String> {
    if id.len() != 36
        || !id.chars().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == '-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
    {
        return Err("invalid subnet UUID".into());
    }
    let c: CloudCidr = cidr.parse()?;
    c.validate_private(true)?;
    let compact = id.replace('-', "");
    let gateway = c.address(1)?;
    let start = c.address(c.ipam_end_offset() + 1)?;
    let end = c.address(c.last() - c.network - 1)?;
    Ok(format!("<network><name>mc-{id}</name><uuid>{id}</uuid><bridge name='mc{}' stp='on' delay='0'/><ip address='{gateway}' prefix='{}'><dhcp><range start='{start}' end='{end}'/></dhcp></ip></network>", &compact[..12], c.prefix))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ScalingPolicy {
    pub min: u32,
    pub max: u32,
    pub desired: u32,
    pub target_cpu: Option<f64>,
    pub cooldown_secs: u32,
}
impl ScalingPolicy {
    pub fn validate(&self) -> Result<(), String> {
        if self.min > self.desired || self.desired > self.max || self.max > 100 {
            return Err("require 0 <= min <= desired <= max <= 100".into());
        }
        if self
            .target_cpu
            .is_some_and(|v| !v.is_finite() || !(10.0..=90.0).contains(&v))
        {
            return Err("target CPU must be 10..90 percent".into());
        }
        if !(30..=86400).contains(&self.cooldown_secs) {
            return Err("cooldown must be 30..86400 seconds".into());
        }
        Ok(())
    }
    /// Missing/stale metrics must never trigger scale-in. One step per cooldown;
    /// 10-point hysteresis prevents small oscillations around the target.
    pub fn next_desired(&self, cpu: Option<f64>, elapsed_secs: i64) -> u32 {
        if elapsed_secs < i64::from(self.cooldown_secs) {
            return self.desired;
        }
        match (
            self.target_cpu,
            cpu.filter(|v| v.is_finite() && (0.0..=100.0).contains(v)),
        ) {
            (Some(target), Some(cpu)) if cpu > target + 10.0 => {
                self.desired.saturating_add(1).min(self.max)
            }
            (Some(target), Some(cpu)) if cpu < target - 10.0 => {
                self.desired.saturating_sub(1).max(self.min)
            }
            _ => self.desired,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cidr_boundaries_and_overlap() {
        let parent: CloudCidr = "10.4.0.0/16".parse().unwrap();
        assert!(parent.contains("10.4.255.0/24".parse().unwrap()));
        assert!(!parent.overlaps("10.5.0.0/16".parse().unwrap()));
        assert!(parent.overlaps("10.0.0.0/8".parse().unwrap()));
        assert!("10.4.0.1/24".parse::<CloudCidr>().is_err());
        for cidr in ["::/0", "10.0.0.0/33", "x", "10.0.0.0/-1"] {
            assert!(cidr.parse::<CloudCidr>().is_err());
        }
        assert_eq!("0.0.0.0/0".parse::<CloudCidr>().unwrap().last(), u32::MAX);
        assert!("8.8.8.0/24"
            .parse::<CloudCidr>()
            .unwrap()
            .validate_private(true)
            .is_err());
    }
    #[test]
    fn isolated_xml_has_disjoint_dhcp_and_ipam_ranges() {
        let xml = cloud_network_xml("12345678-1234-1234-1234-123456789abc", "10.2.3.0/24").unwrap();
        assert!(!xml.contains("<forward"));
        assert!(xml.contains("start='10.2.3.128' end='10.2.3.254'"));
        assert!(xml.contains("mc123456781234"));
        assert_eq!(
            "10.2.3.0/24"
                .parse::<CloudCidr>()
                .unwrap()
                .ipam_end_offset(),
            127
        );
        assert!(cloud_network_xml("';touch /tmp/x", "10.2.3.0/24").is_err());
        assert!(cloud_network_xml("12345678-1234-1234-1234-123456789abc", "10.2.3.0/29").is_err());
    }
    #[test]
    fn scaling_limits_cooldown_and_unknown_metrics() {
        let p = ScalingPolicy {
            min: 1,
            max: 4,
            desired: 2,
            target_cpu: Some(60.0),
            cooldown_secs: 60,
        };
        assert!(p.validate().is_ok());
        assert_eq!(p.next_desired(Some(95.0), 60), 3);
        assert_eq!(p.next_desired(Some(20.0), 60), 1);
        assert_eq!(p.next_desired(Some(95.0), 59), 2);
        for cpu in [None, Some(f64::NAN), Some(101.0), Some(-1.0), Some(60.0)] {
            assert_eq!(p.next_desired(cpu, 600), 2);
        }
        assert!(ScalingPolicy {
            max: 1,
            ..p.clone()
        }
        .validate()
        .is_err());
        assert!(ScalingPolicy {
            target_cpu: Some(f64::INFINITY),
            ..p
        }
        .validate()
        .is_err());
    }
}
