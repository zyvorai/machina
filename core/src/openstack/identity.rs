// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

//! Keystone identity: projects, users, roles, and guarded admin writes.

use osauth::services::{GenericService, VersionSelector};
use reqwest::Method;
use serde::{Deserialize, Serialize};

use crate::config::OpenStackConfig;
use crate::LibvirtError;

use super::auth::{connect_identity_session, map_json_err, map_osauth_err};

const IDENTITY: GenericService = GenericService::new("identity", VersionSelector::Major(3));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenStackProject {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenStackIdentityUser {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub email: Option<String>,
    pub default_project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenStackRole {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenStackRoleAssignment {
    pub role_id: String,
    pub user_id: Option<String>,
    pub project_id: Option<String>,
    pub role_name: Option<String>,
    pub user_name: Option<String>,
}

pub async fn list_identity_projects(
    cfg: &OpenStackConfig,
) -> Result<Vec<OpenStackProject>, LibvirtError> {
    let session = connect_identity_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        projects: Vec<ProjectJson>,
    }
    #[derive(Deserialize)]
    struct ProjectJson {
        id: String,
        name: String,
        #[serde(default = "default_true")]
        enabled: bool,
        #[serde(default)]
        description: Option<String>,
    }
    fn default_true() -> bool {
        true
    }
    let resp = session
        .get(IDENTITY, &["projects"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    let mut out: Vec<_> = body
        .projects
        .into_iter()
        .map(|p| OpenStackProject {
            id: p.id,
            name: p.name,
            enabled: p.enabled,
            description: p.description,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub async fn get_identity_project(
    cfg: &OpenStackConfig,
    id: &str,
) -> Result<OpenStackProject, LibvirtError> {
    let pid = id.trim();
    if pid.is_empty() {
        return Err(LibvirtError::Invalid("project id is required".into()));
    }
    let session = connect_identity_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        project: ProjectJson,
    }
    #[derive(Deserialize)]
    struct ProjectJson {
        id: String,
        name: String,
        #[serde(default = "default_true")]
        enabled: bool,
        #[serde(default)]
        description: Option<String>,
    }
    fn default_true() -> bool {
        true
    }
    let resp = session
        .get(IDENTITY, &["projects", pid])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackProject {
        id: body.project.id,
        name: body.project.name,
        enabled: body.project.enabled,
        description: body.project.description,
    })
}

pub async fn list_identity_users(
    cfg: &OpenStackConfig,
) -> Result<Vec<OpenStackIdentityUser>, LibvirtError> {
    let session = connect_identity_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        users: Vec<UserJson>,
    }
    #[derive(Deserialize)]
    struct UserJson {
        id: String,
        name: String,
        #[serde(default = "default_true")]
        enabled: bool,
        #[serde(default)]
        email: Option<String>,
        #[serde(default)]
        default_project_id: Option<String>,
    }
    fn default_true() -> bool {
        true
    }
    let resp = session
        .get(IDENTITY, &["users"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    let mut out: Vec<_> = body
        .users
        .into_iter()
        .map(|u| OpenStackIdentityUser {
            id: u.id,
            name: u.name,
            enabled: u.enabled,
            email: u.email,
            default_project_id: u.default_project_id,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub async fn get_identity_user(
    cfg: &OpenStackConfig,
    id: &str,
) -> Result<OpenStackIdentityUser, LibvirtError> {
    let uid = id.trim();
    if uid.is_empty() {
        return Err(LibvirtError::Invalid("user id is required".into()));
    }
    let session = connect_identity_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        user: UserJson,
    }
    #[derive(Deserialize)]
    struct UserJson {
        id: String,
        name: String,
        #[serde(default = "default_true")]
        enabled: bool,
        #[serde(default)]
        email: Option<String>,
        #[serde(default)]
        default_project_id: Option<String>,
    }
    fn default_true() -> bool {
        true
    }
    let resp = session
        .get(IDENTITY, &["users", uid])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackIdentityUser {
        id: body.user.id,
        name: body.user.name,
        enabled: body.user.enabled,
        email: body.user.email,
        default_project_id: body.user.default_project_id,
    })
}

pub async fn list_identity_roles(
    cfg: &OpenStackConfig,
) -> Result<Vec<OpenStackRole>, LibvirtError> {
    let session = connect_identity_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        roles: Vec<RoleJson>,
    }
    #[derive(Deserialize)]
    struct RoleJson {
        id: String,
        name: String,
    }
    let resp = session
        .get(IDENTITY, &["roles"])
        .send()
        .await
        .map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    let mut out: Vec<_> = body
        .roles
        .into_iter()
        .map(|r| OpenStackRole {
            id: r.id,
            name: r.name,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub async fn list_role_assignments(
    cfg: &OpenStackConfig,
    project_id: Option<&str>,
) -> Result<Vec<OpenStackRoleAssignment>, LibvirtError> {
    let session = connect_identity_session(cfg).await?;
    #[derive(Deserialize)]
    struct Resp {
        role_assignments: Vec<AssignmentJson>,
    }
    #[derive(Deserialize)]
    struct AssignmentJson {
        role: RoleRef,
        user: Option<UserRef>,
        scope: Option<ScopeRef>,
    }
    #[derive(Deserialize)]
    struct RoleRef {
        id: String,
        #[serde(default)]
        name: Option<String>,
    }
    #[derive(Deserialize)]
    struct UserRef {
        id: String,
        #[serde(default)]
        name: Option<String>,
    }
    #[derive(Deserialize)]
    struct ScopeRef {
        project: Option<ProjectRef>,
    }
    #[derive(Deserialize)]
    struct ProjectRef {
        id: String,
    }
    let mut req = session.get(IDENTITY, &["role_assignments"]);
    if let Some(pid) = project_id.filter(|s| !s.trim().is_empty()) {
        req = req.query(&[("scope.project.id", pid.trim())]);
    }
    let resp = req.send().await.map_err(map_osauth_err)?;
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(body
        .role_assignments
        .into_iter()
        .map(|a| OpenStackRoleAssignment {
            role_id: a.role.id,
            role_name: a.role.name,
            user_id: a.user.as_ref().map(|u| u.id.clone()),
            user_name: a.user.and_then(|u| u.name),
            project_id: a.scope.and_then(|s| s.project.map(|p| p.id)),
        })
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateIdentityProjectRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
}

pub async fn create_identity_project(
    cfg: &OpenStackConfig,
    req: &CreateIdentityProjectRequest,
) -> Result<OpenStackProject, LibvirtError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(LibvirtError::Invalid("project name is required".into()));
    }
    let session = connect_identity_session(cfg).await?;
    let mut project = serde_json::json!({ "name": name });
    if let Some(ref d) = req.description {
        let t = d.trim();
        if !t.is_empty() {
            project["description"] = t.into();
        }
    }
    if let Some(enabled) = req.enabled {
        project["enabled"] = enabled.into();
    }
    let resp = session
        .post(IDENTITY, &["projects"])
        .json(&serde_json::json!({ "project": project }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    #[derive(Deserialize)]
    struct Resp {
        project: ProjectJson,
    }
    #[derive(Deserialize)]
    struct ProjectJson {
        id: String,
        name: String,
        #[serde(default = "default_true")]
        enabled: bool,
        #[serde(default)]
        description: Option<String>,
    }
    fn default_true() -> bool {
        true
    }
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackProject {
        id: body.project.id,
        name: body.project.name,
        enabled: body.project.enabled,
        description: body.project.description,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateIdentityUserRequest {
    pub name: String,
    pub password: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub default_project_id: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
}

pub async fn create_identity_user(
    cfg: &OpenStackConfig,
    req: &CreateIdentityUserRequest,
) -> Result<OpenStackIdentityUser, LibvirtError> {
    let name = req.name.trim();
    if name.is_empty() || req.password.is_empty() {
        return Err(LibvirtError::Invalid(
            "user name and password are required".into(),
        ));
    }
    let session = connect_identity_session(cfg).await?;
    let mut user = serde_json::json!({
        "name": name,
        "password": req.password,
    });
    if let Some(ref e) = req.email {
        let t = e.trim();
        if !t.is_empty() {
            user["email"] = t.into();
        }
    }
    if let Some(ref pid) = req.default_project_id {
        let t = pid.trim();
        if !t.is_empty() {
            user["default_project_id"] = t.into();
        }
    }
    if let Some(enabled) = req.enabled {
        user["enabled"] = enabled.into();
    }
    let resp = session
        .post(IDENTITY, &["users"])
        .json(&serde_json::json!({ "user": user }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    #[derive(Deserialize)]
    struct Resp {
        user: UserJson,
    }
    #[derive(Deserialize)]
    struct UserJson {
        id: String,
        name: String,
        #[serde(default = "default_true")]
        enabled: bool,
        #[serde(default)]
        email: Option<String>,
        #[serde(default)]
        default_project_id: Option<String>,
    }
    fn default_true() -> bool {
        true
    }
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackIdentityUser {
        id: body.user.id,
        name: body.user.name,
        enabled: body.user.enabled,
        email: body.user.email,
        default_project_id: body.user.default_project_id,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateIdentityUserRequest {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub email: Option<String>,
}

pub async fn update_identity_user(
    cfg: &OpenStackConfig,
    id: &str,
    req: &UpdateIdentityUserRequest,
) -> Result<OpenStackIdentityUser, LibvirtError> {
    let uid = id.trim();
    if uid.is_empty() {
        return Err(LibvirtError::Invalid("user id is required".into()));
    }
    if req.enabled.is_none() && req.email.is_none() {
        return Err(LibvirtError::Invalid(
            "at least one field to update is required".into(),
        ));
    }
    let session = connect_identity_session(cfg).await?;
    let mut user = serde_json::Map::new();
    if let Some(enabled) = req.enabled {
        user.insert("enabled".into(), enabled.into());
    }
    if let Some(ref e) = req.email {
        user.insert("email".into(), e.trim().into());
    }
    let resp = session
        .request(IDENTITY, Method::PATCH, &["users", uid])
        .json(&serde_json::json!({ "user": user }))
        .send()
        .await
        .map_err(map_osauth_err)?;
    #[derive(Deserialize)]
    struct Resp {
        user: UserJson,
    }
    #[derive(Deserialize)]
    struct UserJson {
        id: String,
        name: String,
        #[serde(default = "default_true")]
        enabled: bool,
        #[serde(default)]
        email: Option<String>,
        #[serde(default)]
        default_project_id: Option<String>,
    }
    fn default_true() -> bool {
        true
    }
    let body: Resp = resp.json().await.map_err(map_json_err)?;
    Ok(OpenStackIdentityUser {
        id: body.user.id,
        name: body.user.name,
        enabled: body.user.enabled,
        email: body.user.email,
        default_project_id: body.user.default_project_id,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleAssignmentRequest {
    pub project_id: String,
    pub user_id: String,
    pub role_id: String,
}

pub async fn grant_role_assignment(
    cfg: &OpenStackConfig,
    req: &RoleAssignmentRequest,
) -> Result<(), LibvirtError> {
    let pid = req.project_id.trim();
    let uid = req.user_id.trim();
    let rid = req.role_id.trim();
    if pid.is_empty() || uid.is_empty() || rid.is_empty() {
        return Err(LibvirtError::Invalid(
            "project_id, user_id, and role_id are required".into(),
        ));
    }
    let session = connect_identity_session(cfg).await?;
    session
        .put(IDENTITY, &["projects", pid, "users", uid, "roles", rid])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}

pub async fn revoke_role_assignment(
    cfg: &OpenStackConfig,
    req: &RoleAssignmentRequest,
) -> Result<(), LibvirtError> {
    let pid = req.project_id.trim();
    let uid = req.user_id.trim();
    let rid = req.role_id.trim();
    if pid.is_empty() || uid.is_empty() || rid.is_empty() {
        return Err(LibvirtError::Invalid(
            "project_id, user_id, and role_id are required".into(),
        ));
    }
    let session = connect_identity_session(cfg).await?;
    session
        .delete(IDENTITY, &["projects", pid, "users", uid, "roles", rid])
        .send()
        .await
        .map_err(map_osauth_err)?;
    Ok(())
}
