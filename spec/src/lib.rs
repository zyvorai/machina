// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

//! Declarative platform specs (`virt.zyvor.dev/v1`).

mod cluster;
mod error;
mod ha;
mod host;
mod task;
mod template;
mod vm;

pub use cluster::*;
pub use error::*;
pub use ha::*;
pub use host::*;
pub use task::*;
pub use template::*;
pub use vm::*;

pub const API_VERSION: &str = "virt.zyvor.dev/v1";
