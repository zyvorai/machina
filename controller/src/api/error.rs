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
