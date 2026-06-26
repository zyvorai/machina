// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

pub mod automation;
pub mod automation_runner;
pub mod block_jobs;
pub mod boot;
pub mod capabilities;
pub mod cdrom;
pub mod clone;
pub mod cloud_init;
pub mod connection;
pub mod cpu_memory;
pub mod create;
pub mod device;
pub mod device_tune;
pub mod domain;
pub mod domain_job;
pub mod emulator;
pub mod extra_devices;
pub mod extras;
pub mod filesystem;
pub mod firmware;
pub mod graphics_convert;
pub mod guest_agent;
pub mod guest_agent_actions;
pub mod guest_agent_diag;
pub mod guest_agent_provision;
pub mod guest_health;
pub mod guest_input;
pub mod hardware_summary;
pub mod host_cpu;
pub mod host_network;
pub mod host_sysctl;
pub mod hostdev_pci;
pub mod metrics;
pub mod migrate;
pub mod mkosi;
pub mod net_xml;
pub mod network;
pub mod node;
pub mod node_device;
pub mod numa_tune;
pub mod nwfilter;
pub mod pending_config;
pub mod rdp;
pub mod resize;
pub mod save_restore;
pub mod secret;
pub mod snapshot;
pub mod storage;
pub mod subprocess;
pub mod template_apply;
pub mod virt_builder;
pub mod virt_install;
pub mod vnc;

pub use connection::{LibvirtManager, LibvirtTarget};
