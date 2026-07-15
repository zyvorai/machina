// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use serde_json::json;

#[derive(Debug, Clone, Serialize)]
pub struct ObjectRef {
    pub kind: String,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
    pub error_code: Option<String>,
    pub remediation: Option<String>,
    pub object_ref: Option<ObjectRef>,
}

impl ApiError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: msg.into(),
            error_code: None,
            remediation: None,
            object_ref: None,
        }
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: msg.into(),
            error_code: Some("not_found".into()),
            remediation: Some("Verify the resource ID and that it has not been deleted.".into()),
            object_ref: None,
        }
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: msg.into(),
            error_code: Some("internal_error".into()),
            remediation: None,
            object_ref: None,
        }
    }

    pub fn with_code(mut self, code: impl Into<String>) -> Self {
        self.error_code = Some(code.into());
        self
    }

    pub fn with_remediation(mut self, hint: impl Into<String>) -> Self {
        self.remediation = Some(hint.into());
        self
    }

    pub fn with_object(mut self, kind: impl Into<String>, id: impl Into<String>) -> Self {
        self.object_ref = Some(ObjectRef {
            kind: kind.into(),
            id: id.into(),
            name: None,
        });
        self
    }

    pub fn migration_precheck_failed(
        checks: &[crate::engine::migrate_precheck::MigrateCheck],
    ) -> Self {
        let failed: Vec<_> = checks.iter().filter(|c| !c.passed).collect();
        let message = failed
            .iter()
            .map(|c| format!("{}: {}", c.name, c.message))
            .collect::<Vec<_>>()
            .join("; ");
        let remediation = failed
            .first()
            .and_then(|c| c.remediation.clone())
            .unwrap_or_else(|| {
                "Review migration pre-check results and fix failing items before retrying.".into()
            });
        Self {
            status: StatusCode::CONFLICT,
            message,
            error_code: Some("migration_precheck_failed".into()),
            remediation: Some(remediation),
            object_ref: None,
        }
    }

    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: msg.into(),
            error_code: Some("forbidden".into()),
            remediation: None,
            object_ref: None,
        }
    }

    pub fn policy_violation(msg: impl Into<String>, remediation: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: msg.into(),
            error_code: Some("policy_violation".into()),
            remediation: Some(remediation.into()),
            object_ref: None,
        }
    }

    pub fn quota_exceeded(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: msg.into(),
            error_code: Some("quota_exceeded".into()),
            remediation: Some(
                "Raise project quotas in Platform Settings or delete unused VMs.".into(),
            ),
            object_ref: None,
        }
    }

    pub fn conflict(msg: impl Into<String>, remediation: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: msg.into(),
            error_code: Some("conflict".into()),
            remediation: Some(remediation.into()),
            object_ref: None,
        }
    }

    pub fn service_unavailable(msg: impl Into<String>) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: msg.into(),
            error_code: Some("host_unavailable".into()),
            remediation: Some(
                "The target host or its agent is offline or unreachable. Check the host's \
                 connection status and that machina-agent is running, then retry."
                    .into(),
            ),
            object_ref: None,
        }
    }

    /// Classify an error from a call that proxies to a per-host agent over gRPC.
    /// A host that is offline, unreachable, or whose agent rejects the token surfaces
    /// as a transport/connection/auth failure — an upstream availability problem (503),
    /// not a controller bug (500). Everything else keeps the 500 default.
    pub fn from_upstream(e: impl std::fmt::Display) -> Self {
        let msg = e.to_string();
        let m = msg.to_ascii_lowercase();
        let unavailable = m.contains("transport error")
            || m.contains("error trying to connect")
            || m.contains("connection refused")
            || m.contains("deadline exceeded")
            || m.contains("timed out")
            || m.contains("unavailable")
            || m.contains("agent token")
            || m.contains("unauthenticated")
            || m.contains("offline")
            || m.contains("not reachable")
            || m.contains("unreachable")
            || m.contains("no agent");
        if unavailable {
            Self::service_unavailable(msg)
        } else {
            Self::internal(msg)
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        Self::internal(e.to_string())
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        if matches!(e, sqlx::Error::RowNotFound) {
            return Self::not_found("not found");
        }
        if let sqlx::Error::Database(db) = &e {
            if db.code().as_deref() == Some("23505") {
                return Self::conflict(
                    "A resource with this name already exists",
                    "Choose a different name or delete the existing resource first.",
                );
            }
        }
        Self::internal(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_host_transport_error_maps_to_503() {
        let e = ApiError::from_upstream("status: Unavailable, message: \"transport error\"");
        assert_eq!(e.status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(e.error_code.as_deref(), Some("host_unavailable"));
    }

    #[test]
    fn agent_token_rejected_maps_to_503() {
        let e = ApiError::from_upstream(
            "status: Unauthenticated, message: \"invalid or missing agent token\"",
        );
        assert_eq!(e.status, StatusCode::SERVICE_UNAVAILABLE);
    }

    #[test]
    fn genuine_internal_error_stays_500() {
        let e = ApiError::from_upstream("failed to parse json column in row");
        assert_eq!(e.status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(e.error_code.as_deref(), Some("internal_error"));
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut body = json!({ "error": self.message });
        if let Some(code) = self.error_code {
            body["error_code"] = json!(code);
        }
        if let Some(rem) = self.remediation {
            body["remediation"] = json!(rem);
        }
        if let Some(obj) = self.object_ref {
            body["object_ref"] = serde_json::to_value(obj).unwrap_or(json!({}));
        }
        (self.status, Json(body)).into_response()
    }
}
