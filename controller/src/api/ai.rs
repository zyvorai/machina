// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::convert::Infallible;
use std::time::Duration;

use axum::extract::{Query, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Extension;
use axum::Json;
use futures_util::stream::Stream;
use serde::Deserialize;
use tokio_stream::wrappers::ReceiverStream;
use uuid::Uuid;

use crate::api::ApiError;
use crate::auth::AuthUser;
use crate::engine::ai;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct SpotlightBody {
    pub query: String,
}

pub async fn get_settings(State(state): State<AppState>) -> Result<Json<ai::settings::AiSettings>, ApiError> {
    ai::settings::get_ai_settings(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn patch_settings(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<ai::settings::AiSettingsPatch>,
) -> Result<Json<ai::settings::AiSettings>, ApiError> {
    crate::auth::require_admin(&actor)?;
    ai::settings::patch_ai_settings(&state.pool, &body)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn spotlight(
    State(state): State<AppState>,
    Json(body): Json<SpotlightBody>,
) -> Result<Json<ai::SpotlightResult>, ApiError> {
    let online: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM hosts WHERE state = 'online'")
            .fetch_one(&state.pool)
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?;

    let q = body.query.trim();
    let mut hits = Vec::new();
    if !q.is_empty() {
        let vms: Vec<(Uuid, String, String)> = sqlx::query_as(
            "SELECT id, name, observed_state FROM vms WHERE name ILIKE $1 ORDER BY name LIMIT 12",
        )
        .bind(format!("%{q}%"))
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default();
        for (id, name, st) in vms {
            hits.push(ai::SearchHit {
                kind: "vm".into(),
                id: id.to_string(),
                label: name,
                sublabel: Some(st),
            });
        }
    }

    Ok(Json(ai::intent_router::route_spotlight(&body.query, online, hits)))
}

pub async fn jarvis_landing(
    State(state): State<AppState>,
) -> Result<Json<ai::SpotlightResult>, ApiError> {
    let online: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM hosts WHERE state = 'online'")
            .fetch_one(&state.pool)
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(ai::intent_router::jarvis_landing_intents(online)))
}

#[derive(Debug, Deserialize)]
pub struct CopilotBody {
    pub message: String,
    pub vm_id: Option<Uuid>,
    pub host_id: Option<Uuid>,
}

pub async fn copilot_chat(
    State(state): State<AppState>,
    Json(body): Json<CopilotBody>,
) -> Result<Json<ai::CopilotResponse>, ApiError> {
    ai::copilot_chat(
        &state.pool,
        &state.config,
        &body.message,
        body.vm_id,
        body.host_id,
    )
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn copilot_stream(
    State(state): State<AppState>,
    Json(body): Json<CopilotBody>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(64);
    let pool = state.pool.clone();
    let config = state.config.clone();
    let message = body.message;
    let vm_id = body.vm_id;
    let host_id = body.host_id;

    tokio::spawn(async move {
        let send = |data: String| async {
            let _ = tx
                .send(Ok(Event::default().data(data)))
                .await;
        };

        match ai::build_copilot_base(&pool, &config, &message, vm_id, host_id).await {
            Ok(base) => {
                for chunk in ai::chunk_text(&base.reply, 48) {
                    let payload = serde_json::json!({ "type": "chunk", "text": chunk }).to_string();
                    send(payload).await;
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }

                let system =
                    "You are Zeus, an autonomous infrastructure engineer and cloud architect. Be concise. Use bullet points.";
                let mut deterministic = true;
                if let Ok(Some(llm_text)) = ai::llm::complete_simple(
                    &pool,
                    system,
                    &format!("Context: {}\nUser: {}", base.ctx_json, message),
                )
                .await
                {
                    deterministic = false;
                    send(serde_json::json!({ "type": "chunk", "text": "\n\n" }).to_string()).await;
                    for chunk in ai::chunk_text(&llm_text, 48) {
                        let payload =
                            serde_json::json!({ "type": "chunk", "text": chunk }).to_string();
                        send(payload).await;
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                }

                let done = serde_json::json!({
                    "type": "done",
                    "deterministic": deterministic,
                    "context_summary": base.context_summary,
                })
                .to_string();
                send(done).await;
            }
            Err(e) => {
                let err = serde_json::json!({ "type": "error", "message": e.to_string() }).to_string();
                send(err).await;
            }
        }
    });

    Sse::new(ReceiverStream::new(rx)).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

#[derive(Debug, Deserialize)]
pub struct ExplainBody {
    pub screen: String,
    #[serde(default)]
    pub object_ref: serde_json::Value,
}

pub async fn explain(
    State(state): State<AppState>,
    Json(body): Json<ExplainBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let text = ai::explain_screen(&state.pool, &body.screen, &body.object_ref)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(serde_json::json!({ "explanation": text })))
}

#[derive(Debug, Deserialize)]
pub struct RunbookBody {
    pub incident: String,
    #[serde(default)]
    pub context: serde_json::Value,
}

pub async fn runbook(
    State(state): State<AppState>,
    Json(body): Json<RunbookBody>,
) -> Result<Json<ai::runbook::Runbook>, ApiError> {
    ai::runbook::generate(&state.pool, &body.incident, &body.context)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct BlueprintGenBody {
    pub prompt: String,
}

pub async fn generate_blueprint(
    Json(body): Json<BlueprintGenBody>,
) -> Result<Json<ai::blueprint::GeneratedBlueprint>, ApiError> {
    Ok(Json(ai::blueprint::generate_from_nl(&body.prompt)))
}

pub async fn cost_guardian(
    State(state): State<AppState>,
) -> Result<Json<ai::cost::CostAnalysis>, ApiError> {
    ai::cost::analyze(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn capacity_planner(
    State(state): State<AppState>,
) -> Result<Json<ai::capacity::CapacityPlan>, ApiError> {
    ai::capacity::plan(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn security_sentinel(
    State(state): State<AppState>,
) -> Result<Json<ai::security::SecurityReport>, ApiError> {
    ai::security::scan(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct NetworkExplainBody {
    pub vm_a: String,
    pub vm_b: String,
    pub port: Option<i32>,
}

pub async fn policy_export(
    State(state): State<AppState>,
) -> Result<Json<ai::policy_export::PolicyExport>, ApiError> {
    ai::policy_export::export_policy_yaml(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn network_explain(
    State(state): State<AppState>,
    Json(body): Json<NetworkExplainBody>,
) -> Result<Json<ai::network::NetworkExplainResult>, ApiError> {
    ai::network::explain_reach(&state.pool, &body.vm_a, &body.vm_b, body.port)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct MigrationAdvisorQuery {
    pub provider: Option<String>,
    pub vm: String,
    pub os: Option<String>,
    pub disk_path: Option<String>,
    pub host_id: Option<String>,
    #[serde(default)]
    pub has_rdm: bool,
}

pub async fn migration_advisor(
    State(state): State<AppState>,
    Query(q): Query<MigrationAdvisorQuery>,
) -> Result<Json<ai::migration::MigrationAdvisorReport>, ApiError> {
    let provider = q.provider.as_deref().unwrap_or("vmware");
    let mut report = if provider == "vmware" {
        ai::migration::advise_vmware_vm(
            &q.vm,
            q.os.as_deref().unwrap_or("linux"),
            q.has_rdm,
        )
    } else {
        ai::migration::advise_vmware_vm(&q.vm, "linux", false)
    };

    if let Some(disk_path) = q.disk_path.filter(|p| !p.is_empty()) {
        if state.config.guestkit_enabled {
            if let Ok(plan) = crate::engine::guestkit_bridge::migrate_plan_disk(
                &state.config,
                &disk_path,
                "kvm",
            )
            .await
            {
                if let Ok(doc) = crate::engine::guestkit_bridge::doctor_disk(
                    &state.config,
                    &disk_path,
                    "kvm",
                    false,
                )
                .await
                {
                    report = ai::migration::merge_guestkit(
                        report,
                        doc.boot_score,
                        plan.migration_score,
                        &doc.blockers,
                        &doc.warnings,
                        &plan.summary,
                    );
                }
            }
        }
    }

    if let Some(host_id) = q.host_id.filter(|p| !p.is_empty()) {
        if let Ok(detail) =
            crate::engine::zeus_firewall::target_detail(&state.pool, &state.config, &host_id).await
        {
            let deps: Vec<String> = detail
                .inventory
                .open_ports
                .iter()
                .map(|p| format!("{}:{}", p.service_name, p.port))
                .collect();
            report = ai::migration::merge_firewall_migration(report, deps);
        }
    } else {
        let inferred = infer_migration_firewall_deps(&q.vm, q.os.as_deref().unwrap_or("linux"));
        if !inferred.is_empty() {
            report = ai::migration::merge_firewall_migration(report, inferred);
        }
    }

    Ok(Json(report))
}

fn infer_migration_firewall_deps(vm: &str, os: &str) -> Vec<String> {
    let vm_l = vm.to_lowercase();
    let mut deps = vec!["ssh:22".into()];
    if vm_l.contains("db") || vm_l.contains("postgres") || vm_l.contains("mysql") {
        deps.push("postgresql:5432".into());
        deps.push("mysql:3306".into());
    }
    if vm_l.contains("web") || vm_l.contains("nginx") || vm_l.contains("apache") {
        deps.push("http:80".into());
        deps.push("https:443".into());
    }
    if vm_l.contains("ldap") || vm_l.contains("ad") {
        deps.push("ldap:389".into());
    }
    if vm_l.contains("erp") || vm_l.contains("oracle") {
        deps.push("oracle:1521".into());
        deps.push("smtp:25".into());
    }
    if os.to_lowercase().contains("windows") {
        deps.push("rdp:3389".into());
    }
    deps
}

pub async fn vm_doctor(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<Json<crate::engine::vm_health::VmHealthReport>, ApiError> {
    crate::engine::vm_health::run_vm_health_check(&state.pool, id)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct AutopilotProposeQuery {
    pub vm_id: Option<Uuid>,
}

pub async fn autopilot_propose(
    State(state): State<AppState>,
    Query(q): Query<AutopilotProposeQuery>,
) -> Result<Json<ai::autopilot::AutopilotProposal>, ApiError> {
    ai::autopilot::propose(&state.pool, q.vm_id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn autopilot_execute(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<ai::autopilot::ExecuteBody>,
) -> Result<Json<ai::autopilot::ExecuteResult>, ApiError> {
    ai::autopilot::execute(&state, &actor, &body)
        .await
        .map(Json)
}

pub async fn compliance_report(
    State(state): State<AppState>,
) -> Result<Json<ai::compliance::ComplianceReport>, ApiError> {
    ai::compliance::generate(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn compliance_export_html(
    State(state): State<AppState>,
) -> Result<axum::response::Html<String>, ApiError> {
    let report = ai::compliance::generate(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(axum::response::Html(ai::compliance::report_to_html(&report)))
}

pub async fn compliance_export_pdf(
    State(state): State<AppState>,
) -> Result<axum::response::Response, ApiError> {
    let report = ai::compliance::generate(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let bytes = ai::compliance::report_to_pdf(&report);
    Ok(axum::response::Response::builder()
        .header(http::header::CONTENT_TYPE, "application/pdf")
        .header(
            http::header::CONTENT_DISPOSITION,
            "attachment; filename=\"machina-compliance-report.pdf\"",
        )
        .body(axum::body::Body::from(bytes))
        .map_err(|e| ApiError::internal(e.to_string()))?)
}

#[derive(Debug, Deserialize)]
pub struct TerminalSuggestBody {
    pub vm_id: Option<Uuid>,
    pub vm_name: Option<String>,
}

pub async fn terminal_suggest(
    State(state): State<AppState>,
    Json(body): Json<TerminalSuggestBody>,
) -> Result<Json<ai::terminal::TerminalSuggestResult>, ApiError> {
    ai::terminal::suggest(
        &state.pool,
        body.vm_id,
        body.vm_name.as_deref(),
    )
    .await
    .map_err(|e| ApiError::internal(e.to_string()))
    .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct AutopilotRunBody {
    #[serde(default)]
    pub vm_id: Option<Uuid>,
    #[serde(default = "default_max_actions")]
    pub max_actions: usize,
}

fn default_max_actions() -> usize {
    3
}

pub async fn autopilot_run(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<AutopilotRunBody>,
) -> Result<Json<ai::autopilot::AutopilotRunResult>, ApiError> {
    let settings = ai::settings::get_ai_settings(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let cap = settings.autopilot_max_actions.clamp(1, 10) as usize;
    let max = if body.max_actions == default_max_actions() {
        cap
    } else {
        body.max_actions.min(cap)
    };
    ai::autopilot::run_safe_batch(&state, &actor, body.vm_id, max)
        .await
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct AutopilotHistoryQuery {
    #[serde(default = "default_history_limit")]
    pub limit: i64,
}

fn default_history_limit() -> i64 {
    20
}

pub async fn autopilot_history(
    State(state): State<AppState>,
    Query(q): Query<AutopilotHistoryQuery>,
) -> Result<Json<Vec<ai::autopilot::AutopilotHistoryEntry>>, ApiError> {
    ai::autopilot::list_history(&state.pool, q.limit)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn capacity_export_csv(
    State(state): State<AppState>,
) -> Result<axum::response::Response, ApiError> {
    let csv = ai::capacity::export_csv(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(axum::response::Response::builder()
        .header(http::header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            http::header::CONTENT_DISPOSITION,
            "attachment; filename=\"machina-capacity-planner.csv\"",
        )
        .body(axum::body::Body::from(csv))
        .map_err(|e| ApiError::internal(e.to_string()))?)
}

pub async fn cost_export_csv(
    State(state): State<AppState>,
) -> Result<axum::response::Response, ApiError> {
    let csv = ai::cost::export_csv(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(axum::response::Response::builder()
        .header(http::header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            http::header::CONTENT_DISPOSITION,
            "attachment; filename=\"machina-cost-guardian.csv\"",
        )
        .body(axum::body::Body::from(csv))
        .map_err(|e| ApiError::internal(e.to_string()))?)
}

pub async fn fleet_summary(
    State(state): State<AppState>,
) -> Result<Json<ai::fleet_summary::FleetZeusSummary>, ApiError> {
    ai::fleet_summary::summarize(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn fleet_local(
    State(state): State<AppState>,
) -> Result<Json<ai::fleet_summary::FleetClusterSlice>, ApiError> {
    ai::fleet_summary::local_export(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn twin_graph(
    State(state): State<AppState>,
) -> Result<Json<ai::digital_twin::DigitalTwinGraph>, ApiError> {
    ai::digital_twin::build_graph(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn twin_impact(
    State(state): State<AppState>,
    Json(body): Json<ai::digital_twin::ImpactRequest>,
) -> Result<Json<ai::digital_twin::ImpactAnalysis>, ApiError> {
    ai::digital_twin::analyze_impact(&state.pool, &body)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))
        .map(Json)
}

pub async fn analyze_incident(
    State(state): State<AppState>,
    Query(q): Query<ai::root_cause::AnalyzeIncidentQuery>,
) -> Result<Json<ai::root_cause::IncidentAnalysis>, ApiError> {
    let mut result = ai::root_cause::analyze(&state.pool, &q)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    if state.config.packetwolf_enabled {
        let pw = crate::engine::packetwolf_bridge::fetch_anomalies(&state.config).await;
        ai::root_cause::merge_packetwolf(&mut result.timeline, &pw);
    }
    Ok(Json(result))
}

#[derive(Debug, Deserialize)]
pub struct EnvironmentIntentBody {
    pub query: String,
}

pub async fn intent_environment(
    State(state): State<AppState>,
    Json(body): Json<EnvironmentIntentBody>,
) -> Result<Json<ai::environment_intent::EnvironmentResourcePlan>, ApiError> {
    let rates: (f64, f64) = sqlx::query_as(
        "SELECT finops_vcpu_hour_usd, finops_gib_hour_usd FROM clusters ORDER BY created_at LIMIT 1",
    )
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(ai::environment_intent::plan_environment(
        &body.query,
        rates.0,
        rates.1,
    )))
}

pub async fn intent_environment_execute(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<ai::environment_intent::EnvironmentExecuteBody>,
) -> Result<Json<ai::environment_intent::EnvironmentExecuteResult>, ApiError> {
    ai::environment_intent::execute_environment(&state, &actor, &body).await.map(Json)
}

pub async fn sre_forecast(
    State(state): State<AppState>,
) -> Result<Json<ai::sre_predict::SreForecastReport>, ApiError> {
    ai::sre_predict::forecast(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn sre_remediate(
    State(state): State<AppState>,
) -> Result<Json<ai::sre_remediate::SreRemediationReport>, ApiError> {
    ai::sre_remediate::propose(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn compliance_remediate(
    State(state): State<AppState>,
) -> Result<Json<ai::compliance_remediate::ComplianceRemediationReport>, ApiError> {
    ai::compliance_remediate::propose(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn zeus_summary(
    State(state): State<AppState>,
) -> Result<Json<ai::zeus_summary::ZeusOsSummary>, ApiError> {
    ai::zeus_summary::summarize(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn fleet_power_optimize(
    State(state): State<AppState>,
) -> Result<Json<ai::fleet_power::FleetPowerReport>, ApiError> {
    ai::fleet_power::optimize(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn fleet_heatmap(
    State(state): State<AppState>,
) -> Result<Json<ai::fleet_heatmap::FleetHeatmap>, ApiError> {
    ai::fleet_heatmap::heatmap(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct RebalanceQuery {
    #[serde(default = "default_rebalance_max")]
    pub max_moves: usize,
}

fn default_rebalance_max() -> usize {
    5
}

pub async fn fleet_rebalance_propose(
    State(state): State<AppState>,
    Query(q): Query<RebalanceQuery>,
) -> Result<Json<ai::fleet_rebalance::RebalanceProposal>, ApiError> {
    ai::fleet_rebalance::propose(&state.pool, q.max_moves)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn fleet_rebalance_execute(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<ai::fleet_rebalance::RebalanceExecuteBody>,
) -> Result<Json<ai::fleet_rebalance::RebalanceExecuteResult>, ApiError> {
    ai::fleet_rebalance::execute(&state, &actor, &body).await.map(Json)
}

pub async fn cost_attribution(
    State(state): State<AppState>,
) -> Result<Json<ai::cost_attribution::CostAttributionReport>, ApiError> {
    ai::cost_attribution::attribute(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn compliance_frameworks(
    State(state): State<AppState>,
) -> Result<Json<ai::compliance_frameworks::ComplianceFrameworksReport>, ApiError> {
    ai::compliance_frameworks::scan(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn security_graph(
    State(state): State<AppState>,
) -> Result<Json<ai::security_graph::SecurityGraph>, ApiError> {
    ai::security_graph::build_graph(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn security_attack_path(
    State(state): State<AppState>,
    Json(body): Json<ai::security_graph::AttackPathQuery>,
) -> Result<Json<ai::security_graph::AttackPathResult>, ApiError> {
    ai::security_graph::attack_path(&state.pool, &body)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct KnowledgeSearchBody {
    pub query: String,
}

pub async fn knowledge_search(
    State(state): State<AppState>,
    Json(body): Json<KnowledgeSearchBody>,
) -> Result<Json<ai::knowledge_search::KnowledgeSearchResult>, ApiError> {
    ai::knowledge_search::search(&state.pool, &body.query)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn service_graph(
    State(state): State<AppState>,
) -> Result<Json<ai::service_graph::ServiceGraph>, ApiError> {
    ai::service_graph::build(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct MemoryQuery {
    #[serde(default = "default_memory_limit")]
    pub limit: i64,
}

fn default_memory_limit() -> i64 {
    20
}

pub async fn infrastructure_memory(
    State(state): State<AppState>,
    Query(q): Query<MemoryQuery>,
) -> Result<Json<ai::infrastructure_memory::InfrastructureMemory>, ApiError> {
    ai::infrastructure_memory::recall(&state.pool, q.limit)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct MissionStackBody {
    pub query: String,
}

pub async fn mission_stack(
    State(state): State<AppState>,
    Json(body): Json<MissionStackBody>,
) -> Result<Json<ai::mission_stack::MissionStackPlan>, ApiError> {
    let rates: (f64, f64) = sqlx::query_as(
        "SELECT finops_vcpu_hour_usd, finops_gib_hour_usd FROM clusters ORDER BY created_at LIMIT 1",
    )
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(ai::mission_stack::plan_mission_stack(
        &body.query,
        rates.0,
        rates.1,
    )))
}

pub async fn mission_stack_execute(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<ai::mission_stack::MissionStackExecuteBody>,
) -> Result<Json<ai::mission_stack::MissionStackExecuteResult>, ApiError> {
    ai::mission_stack::execute_stack(&state, &actor, &body).await.map(Json)
}

pub async fn cost_attribution_export_csv(
    State(state): State<AppState>,
) -> Result<axum::response::Response, ApiError> {
    let csv = ai::cost_attribution::export_csv(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(axum::response::Response::builder()
        .header(http::header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            http::header::CONTENT_DISPOSITION,
            "attachment; filename=\"machina-cost-attribution.csv\"",
        )
        .body(axum::body::Body::from(csv))
        .map_err(|e| ApiError::internal(e.to_string()))?)
}

#[derive(Debug, Deserialize)]
pub struct GpuPlacementQuery {
    #[serde(default = "default_gpu_workload")]
    pub workload: String,
}

fn default_gpu_workload() -> String {
    "inference".into()
}

pub async fn fleet_gpu_placement(
    State(state): State<AppState>,
    Query(q): Query<GpuPlacementQuery>,
) -> Result<Json<ai::fleet_placement::GpuPlacementReport>, ApiError> {
    ai::fleet_placement::advise_gpu(&state.pool, &q.workload)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn knowledge_diagnose(
    State(state): State<AppState>,
    Json(body): Json<KnowledgeSearchBody>,
) -> Result<Json<ai::knowledge_diagnose::KnowledgeDiagnosis>, ApiError> {
    ai::knowledge_diagnose::diagnose(&state.pool, &body.query)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn service_impact(
    State(state): State<AppState>,
    Json(body): Json<ai::service_impact::ServiceImpactQuery>,
) -> Result<Json<ai::service_impact::ServiceImpactResult>, ApiError> {
    ai::service_impact::simulate(&state.pool, &body)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct SimilarMemoryQuery {
    pub q: String,
    #[serde(default = "default_memory_limit")]
    pub limit: i64,
}

pub async fn memory_similar(
    State(state): State<AppState>,
    Query(q): Query<SimilarMemoryQuery>,
) -> Result<Json<ai::infrastructure_memory::SimilarIncidentsResult>, ApiError> {
    ai::infrastructure_memory::similar(&state.pool, &q.q, q.limit)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn remediate_hub(
    State(state): State<AppState>,
) -> Result<Json<ai::remediate_hub::RemediateHub>, ApiError> {
    ai::remediate_hub::hub(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn knowledge_runbook(
    State(state): State<AppState>,
    Json(body): Json<KnowledgeSearchBody>,
) -> Result<Json<ai::knowledge_runbook::KnowledgeRunbook>, ApiError> {
    ai::knowledge_runbook::from_query(&state.pool, &body.query)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn cost_budget(
    State(state): State<AppState>,
) -> Result<Json<ai::cost_budget::CostBudgetReport>, ApiError> {
    ai::cost_budget::analyze(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn mission_stack_status(
    State(state): State<AppState>,
) -> Result<Json<ai::mission_stack_status::MissionStackStatus>, ApiError> {
    ai::mission_stack_status::status(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

// --- Zeus AI redesign APIs ---

pub async fn list_ai_providers(
    State(state): State<AppState>,
) -> Result<Json<Vec<ai::providers::AiProviderRow>>, ApiError> {
    ai::providers::list_providers(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn create_ai_provider(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<ai::providers::CreateProviderBody>,
) -> Result<Json<ai::providers::AiProviderRow>, ApiError> {
    crate::auth::require_admin(&actor)?;
    ai::providers::create_provider(&state.pool, &body)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn patch_ai_provider(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
    Json(body): Json<ai::providers::PatchProviderBody>,
) -> Result<Json<ai::providers::AiProviderRow>, ApiError> {
    crate::auth::require_admin(&actor)?;
    ai::providers::patch_provider(&state.pool, id, &body)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn delete_ai_provider(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    crate::auth::require_admin(&actor)?;
    let ok = ai::providers::delete_provider(&state.pool, id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(serde_json::json!({ "deleted": ok })))
}

pub async fn list_ai_provider_models(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<Json<Vec<ai::providers::AiModelRow>>, ApiError> {
    ai::providers::list_models(&state.pool, id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn test_ai_provider(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    crate::auth::require_admin(&actor)?;
    ai::providers::test_provider(&state.pool, id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn list_routing_rules(
    State(state): State<AppState>,
) -> Result<Json<Vec<ai::routing::RoutingRuleRow>>, ApiError> {
    ai::routing::list_rules(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn list_zeus_agents(
    State(_state): State<AppState>,
) -> Result<Json<Vec<ai::agents::ZeusAgentInfo>>, ApiError> {
    Ok(Json(ai::agents::catalog()))
}

pub async fn zeus_chat(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<ai::agents::ZeusChatBody>,
) -> Result<Json<ai::agents::ZeusChatResponse>, ApiError> {
    ai::agents::chat(&state.pool, &state.config, &body, Some(&actor.username))
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn list_ai_prompts(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<Vec<ai::prompts::PromptRow>>, ApiError> {
    ai::prompts::list_prompts(&state.pool, &actor.username)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn create_ai_prompt(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<ai::prompts::CreatePromptBody>,
) -> Result<Json<ai::prompts::PromptRow>, ApiError> {
    ai::prompts::create_prompt(&state.pool, &actor.username, &body)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn patch_ai_prompt(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
    Json(body): Json<ai::prompts::PatchPromptBody>,
) -> Result<Json<ai::prompts::PromptRow>, ApiError> {
    let _ = actor;
    ai::prompts::patch_prompt(&state.pool, id, &body)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn delete_ai_prompt(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let _ = actor;
    let ok = ai::prompts::delete_prompt(&state.pool, id)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(serde_json::json!({ "deleted": ok })))
}

pub async fn get_memory_settings(
    State(state): State<AppState>,
) -> Result<Json<ai::memory_store::MemorySettings>, ApiError> {
    ai::memory_store::get_settings(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn patch_memory_settings(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<ai::memory_store::MemorySettingsPatch>,
) -> Result<Json<ai::memory_store::MemorySettings>, ApiError> {
    crate::auth::require_admin(&actor)?;
    ai::memory_store::patch_settings(&state.pool, &body)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

#[derive(Debug, Deserialize)]
pub struct MemoryPurgeQuery {
    pub scope: String,
}

pub async fn purge_memory(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Query(q): Query<MemoryPurgeQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    crate::auth::require_admin(&actor)?;
    let deleted = ai::memory_store::purge(&state.pool, &q.scope, Some(&actor.username))
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(serde_json::json!({ "deleted": deleted })))
}

pub async fn zeus_approval_hub(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, ApiError> {
    ai::actions::approval_hub(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn create_zeus_action(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<ai::actions::CreateActionBody>,
) -> Result<Json<ai::actions::ZeusActionRow>, ApiError> {
    ai::actions::create_action(&state.pool, &body, &actor.username)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn execute_zeus_action(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    ai::actions::approve_and_execute(&state, id, &actor)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn reject_zeus_action(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let ok = ai::actions::reject(&state.pool, id, &actor.username)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(serde_json::json!({ "rejected": ok })))
}

pub async fn list_agent_marketplace(
    State(state): State<AppState>,
) -> Result<Json<Vec<ai::agent_marketplace::AgentPluginRow>>, ApiError> {
    ai::agent_marketplace::list_agents(&state.pool)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn install_agent_marketplace(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    axum::extract::Path(slug): axum::extract::Path<String>,
) -> Result<Json<ai::agent_marketplace::AgentPluginRow>, ApiError> {
    crate::auth::require_admin(&actor)?;
    ai::agent_marketplace::install(&state.pool, &slug)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn uninstall_agent_marketplace(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    axum::extract::Path(slug): axum::extract::Path<String>,
) -> Result<Json<ai::agent_marketplace::AgentPluginRow>, ApiError> {
    crate::auth::require_admin(&actor)?;
    ai::agent_marketplace::uninstall(&state.pool, &slug)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn zeus_enterprise_overview(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
) -> Result<Json<ai::enterprise_zeus::ZeusEnterpriseOverview>, ApiError> {
    ai::enterprise_zeus::overview(&state.pool, &actor.username)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn zeus_autonomous_plan(
    State(state): State<AppState>,
    Json(body): Json<ai::autonomous::AutonomousPlanBody>,
) -> Result<Json<ai::autonomous::AutonomousPlanResult>, ApiError> {
    ai::autonomous::plan(&state.pool, &state.config, &body)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}

pub async fn zeus_autonomous_execute(
    State(state): State<AppState>,
    Extension(actor): Extension<AuthUser>,
    Json(body): Json<ai::autonomous::AutonomousExecuteBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    ai::autonomous::execute_approved_plan(&state.pool, &state.config, &state, &actor, &body)
        .await
        .map_err(|e| ApiError::internal(e.to_string()))
        .map(Json)
}
