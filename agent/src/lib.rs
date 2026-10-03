// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

pub mod console_ws;
pub mod grpc;
pub mod jwt;
pub mod libvirt_invoke;
pub mod libvirt_ops;
pub mod provision_ops;
pub mod state;

pub mod pb {
    tonic::include_proto!("machina.agent.v1");
}
