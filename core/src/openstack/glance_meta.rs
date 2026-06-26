// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

//! Glance image metadata and project members.

use osauth::services::IMAGE;
use serde::{Deserialize, Serialize};

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::auth::{connect_session, map_json_err, map_osauth_err};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateImageMetadataRequest {
    pub properties: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OpenStackImageMember {
    pub member_id: String,
    pub status: String,
}

pub async fn update_image_metadata(
    cfg: &OpenStackConfig,
    image_id: &str,
    req: &UpdateImageMetadataRequest,
) -> Result<std::collections::HashMap<String, String>, LibvirtError> {
    if req.properties.is_empty() {
        return Err(LibvirtError::Invalid("properties must not be empty".into()));
    }
    let session = connect_session(cfg).await?;
    let body = serde_json::json!({ "properties": req.properties });
    let resp = session
        .put(IMAGE, &["images", image_id.trim()])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    #[derive(Deserialize)]
    struct ImgResp {
        properties: std::collections::HashMap<String, String>,
    }
    let parsed: ImgResp = resp.json().await.map_err(map_json_err)?;
    Ok(parsed.properties)
}

pub async fn list_image_members(
    cfg: &OpenStackConfig,
    image_id: &str,
) -> Result<Vec<OpenStackImageMember>, LibvirtError> {
    let session = connect_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        members: Vec<MemberJson>,
    }
    #[derive(Deserialize)]
    struct MemberJson {
        member_id: String,
        status: String,
    }
    let resp = session
        .get(IMAGE, &["images", image_id.trim(), "members"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(body
        .members
        .into_iter()
        .map(|m| OpenStackImageMember {
            member_id: m.member_id,
            status: m.status,
        })
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddImageMemberRequest {
    pub member_id: String,
}

pub async fn add_image_member(
    cfg: &OpenStackConfig,
    image_id: &str,
    req: &AddImageMemberRequest,
) -> Result<OpenStackImageMember, LibvirtError> {
    let member = req.member_id.trim();
    if member.is_empty() {
        return Err(LibvirtError::Invalid("member_id is required".into()));
    }
    let session = connect_session(cfg).await?;
    let body = serde_json::json!({ "member": member });
    #[derive(Deserialize)]
    struct Resp {
        member_id: String,
        status: String,
    }
    let resp = session
        .post(IMAGE, &["images", image_id.trim(), "members"])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    let parsed: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackImageMember {
        member_id: parsed.member_id,
        status: parsed.status,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateImageVisibilityRequest {
    /// `private`, `public`, `shared`, or `community`.
    pub visibility: String,
}

pub async fn update_image_visibility(
    cfg: &OpenStackConfig,
    image_id: &str,
    req: &UpdateImageVisibilityRequest,
) -> Result<String, LibvirtError> {
    let vis = req.visibility.trim();
    if vis.is_empty() {
        return Err(LibvirtError::Invalid("visibility is required".into()));
    }
    let session = connect_session(cfg).await?;
    let body = serde_json::json!({ "visibility": vis });
    let resp = session
        .put(IMAGE, &["images", image_id.trim()])
        .json(&body)
        .send()
        .await
        .map_err(map_osauth_err)?;
    #[derive(Deserialize)]
    struct ImgResp {
        visibility: String,
    }
    let parsed: ImgResp = resp.json().await.map_err(map_json_err)?;
    Ok(parsed.visibility)
}

pub async fn delete_image_member(
    cfg: &OpenStackConfig,
    image_id: &str,
    member_id: &str,
) -> Result<(), LibvirtError> {
    let session = connect_session(cfg).await?;
    session
        .delete(
            IMAGE,
            &["images", image_id.trim(), "members", member_id.trim()],
        )
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}
