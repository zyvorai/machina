// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyModifiers, MouseEvent, MouseEventKind};
use ratatui::DefaultTerminal;
use std::time::{Duration, Instant};

use machina_core::{
    format_user_error, AppState, AssociateFloatingIpRequest, ConfirmationDialog,
    CreateInstanceRequest, CreateNetworkRequest, Focus, InputMode, NotifyLevel, ObjectTab,
    OpenStackCreateStep, OpenStackCreateWizard, ResourceView, SidebarCategory, SidebarItem,
    SortColumn, SortDirection, ViewMode,
};

use crate::api::DaemonClient;
use crate::ui;

const PACKER_IMAGE_HINT: &str = "Web /create: ISO install, Packer qcow2 builds, clone golden image (saved template or backing). Packer script: /usr/local/share/machina/packer/build-linux-image.sh";

fn status_err(prefix: &str, e: impl std::fmt::Display) -> String {
    format!("{prefix}: {}", format_user_error(&e.to_string()))
}

pub struct App {
    pub state: AppState,
    pub should_quit: bool,
    client: DaemonClient,
    refresh_interval: Duration,
    sidebar_width: u16,
}

impl App {
    pub fn new(client: DaemonClient, refresh_interval_secs: u64) -> Self {
        Self {
            state: AppState::new(),
            should_quit: false,
            client,
            refresh_interval: Duration::from_secs(refresh_interval_secs),
            sidebar_width: 24,
        }
    }

    pub async fn run(&mut self, mut terminal: DefaultTerminal) -> anyhow::Result<()> {
        self.state.load_audit_history();
        self.refresh_all_data().await;

        let mut last_refresh = Instant::now();

        while !self.should_quit {
            let term_width = terminal.get_frame().area().width;
            self.sidebar_width = (term_width / 5).clamp(22, 30);

            terminal.draw(|frame| ui::render(frame, &self.state))?;

            if event::poll(Duration::from_millis(250))? {
                match event::read()? {
                    Event::Key(key) => self.handle_key(key).await,
                    Event::Mouse(mouse) => self.handle_mouse(mouse),
                    _ => {}
                }
            }

            if last_refresh.elapsed() >= self.refresh_interval {
                self.refresh_vms_and_metrics().await;
                last_refresh = Instant::now();
            }
        }

        Ok(())
    }

    async fn handle_key(&mut self, key: KeyEvent) {
        match self.state.input_mode {
            InputMode::Search => self.handle_search_key(key),
            InputMode::Confirmation => self.handle_confirmation_key(key).await,
            InputMode::Command => self.handle_command_key(key).await,
            InputMode::OpenStackWizard => self.handle_openstack_wizard_key(key).await,
            InputMode::Normal => self.handle_normal_key(key).await,
        }
    }

    fn openstack_wizard_active(&self) -> bool {
        self.state.view_mode == ViewMode::OpenStackCreate
            && self.state.openstack_create_wizard.is_some()
    }

    // ── Scrollable view handling (shared by Help, Xml, Logs) ────────────

    fn handle_scroll_keys(&mut self, key: KeyEvent, scroll: &mut u16, exit_on_any: bool) -> bool {
        match key.code {
            KeyCode::Char('j') | KeyCode::Down => *scroll = scroll.saturating_add(1),
            KeyCode::Char('k') | KeyCode::Up => *scroll = scroll.saturating_sub(1),
            KeyCode::PageDown => *scroll = scroll.saturating_add(20),
            KeyCode::PageUp => *scroll = scroll.saturating_sub(20),
            KeyCode::Char('g') => *scroll = 0,
            KeyCode::Esc | KeyCode::Char('q') => return true,
            _ => {
                if exit_on_any {
                    return true;
                }
            }
        }
        false
    }

    // ── Normal mode (3-layer dispatch) ──────────────────────────────────

    async fn handle_normal_key(&mut self, key: KeyEvent) {
        if self.state.show_context_menu {
            self.handle_context_menu_key(key).await;
            return;
        }

        // ViewMode overlays — Logs and Xml share identical scroll+exit logic
        match self.state.view_mode {
            ViewMode::Help => {
                let mut scroll = self.state.help_scroll;
                let exit = self.handle_scroll_keys(key, &mut scroll, true);
                self.state.help_scroll = scroll;
                if exit {
                    self.state.view_mode = ViewMode::Table;
                    self.state.help_scroll = 0;
                }
                return;
            }
            ViewMode::Logs | ViewMode::Xml => {
                let mut scroll = self.state.scroll_offset;
                let exit = self.handle_scroll_keys(key, &mut scroll, false);
                self.state.scroll_offset = scroll;
                if exit {
                    self.state.view_mode = ViewMode::Table;
                    self.state.xml_content.clear();
                    self.state.log_content.clear();
                    self.state.content_overlay_caption.clear();
                    self.state.scroll_offset = 0;
                }
                return;
            }
            ViewMode::OpenStackCreate => {
                self.handle_openstack_create_view_key(key).await;
                return;
            }
            ViewMode::Table => {}
        }

        // Layer 1: Global keys (any focus)
        if key.code == KeyCode::Char(' ') && key.modifiers.contains(KeyModifiers::CONTROL) {
            self.state.show_context_menu = true;
            return;
        }

        match key.code {
            KeyCode::Char('q') | KeyCode::Esc => {
                if self.openstack_wizard_active() {
                    self.cancel_openstack_create_wizard();
                    return;
                }
                if self.state.multi_select_mode {
                    self.state.clear_selection();
                } else if self.state.command_content_override.is_some() {
                    self.state.command_content_override = None;
                } else {
                    self.should_quit = true;
                }
                return;
            }
            KeyCode::Char('?') | KeyCode::F(1) => {
                self.state.view_mode = ViewMode::Help;
                self.state.help_scroll = 0;
                return;
            }
            KeyCode::Char('/') => {
                self.state.input_mode = InputMode::Search;
                self.state.search_query.clear();
                self.state.search_active = false;
                self.state.filtered_indices.clear();
                return;
            }
            KeyCode::Char(':') => {
                self.state.input_mode = InputMode::Command;
                self.state.command_input.clear();
                return;
            }
            KeyCode::Char('r') => {
                if let Some(SidebarItem::StoragePool(name)) =
                    self.state.selected_sidebar_item().cloned()
                {
                    let r = self.client.refresh_pool(&name).await;
                    self.report_cmd_result(
                        r,
                        &format!("Refreshed pool '{name}'"),
                        "refresh-pool",
                        &name,
                        true,
                    )
                    .await;
                } else {
                    self.refresh_all_data().await;
                }
                return;
            }
            _ => {}
        }

        // Layer 2: Focus switching
        match key.code {
            KeyCode::Char('h') | KeyCode::Left => {
                if self.state.focus == Focus::Content {
                    self.state.focus = Focus::Sidebar;
                    return;
                }
            }
            KeyCode::Right => {
                if self.state.focus == Focus::Sidebar {
                    self.state.focus = Focus::Content;
                    if let Some(SidebarItem::Vm(name)) = self.state.selected_sidebar_item().cloned()
                    {
                        if self
                            .state
                            .vm_details
                            .as_ref()
                            .is_none_or(|d| d.name != name)
                        {
                            self.load_vm_details(&name).await;
                        }
                    }
                    return;
                }
            }
            KeyCode::Char('l') => {
                if self.state.focus == Focus::Sidebar
                    && !matches!(self.state.selected_sidebar_item(), Some(SidebarItem::Vm(_)))
                {
                    self.state.focus = Focus::Content;
                    return;
                }
            }
            _ => {}
        }

        // Layer 3: Dispatch to focus-specific handler
        match self.state.focus {
            Focus::Sidebar => self.handle_sidebar_key(key).await,
            Focus::Content => self.handle_content_key(key).await,
        }
    }

    // ── Sidebar navigation helper ───────────────────────────────────────

    async fn navigate_sidebar(&mut self, new_pos: usize) {
        if !self.state.sidebar_items.is_empty() {
            self.state.sidebar_selected = new_pos.min(self.state.sidebar_items.len() - 1);
            self.on_sidebar_selection_changed().await;
        }
    }

    // ── Sidebar key handling ────────────────────────────────────────────

    async fn handle_sidebar_key(&mut self, key: KeyEvent) {
        let len = self.state.sidebar_items.len();
        match key.code {
            KeyCode::Char('j') | KeyCode::Down => {
                if len > 0 {
                    self.navigate_sidebar((self.state.sidebar_selected + 1) % len)
                        .await;
                }
            }
            KeyCode::Char('k') | KeyCode::Up => {
                if len > 0 {
                    let pos = if self.state.sidebar_selected == 0 {
                        len - 1
                    } else {
                        self.state.sidebar_selected - 1
                    };
                    self.navigate_sidebar(pos).await;
                }
            }
            KeyCode::Char('g') => self.navigate_sidebar(0).await,
            KeyCode::Char('G') => {
                if len > 0 {
                    self.navigate_sidebar(len - 1).await;
                }
            }
            KeyCode::PageDown => {
                self.navigate_sidebar(self.state.sidebar_selected + 10)
                    .await
            }
            KeyCode::PageUp => {
                self.navigate_sidebar(self.state.sidebar_selected.saturating_sub(10))
                    .await;
            }

            KeyCode::Char(' ') => match self.state.selected_sidebar_item().cloned() {
                Some(SidebarItem::Category(_)) => self.state.toggle_sidebar_collapse(),
                Some(SidebarItem::Vm(name)) => self.toggle_multi_select(&name),
                _ => {}
            },

            KeyCode::Enter => match self.state.selected_sidebar_item().cloned() {
                Some(SidebarItem::Category(_)) => self.state.toggle_sidebar_collapse(),
                Some(SidebarItem::Vm(name)) => {
                    if self.state.multi_select_mode {
                        self.state.toggle_selection(&name);
                    } else {
                        self.load_vm_details(&name).await;
                        self.state.focus = Focus::Content;
                        self.state.active_object_tab = ObjectTab::Summary;
                    }
                }
                Some(SidebarItem::StoragePool(name)) => {
                    self.browse_pool_volumes_by_name(&name).await;
                    self.state.focus = Focus::Content;
                }
                Some(SidebarItem::Network(_)) | Some(SidebarItem::Snapshot(_, _)) => {
                    self.state.focus = Focus::Content;
                }
                Some(SidebarItem::OpenStackInstance(id)) => {
                    self.load_openstack_instance_detail(&id).await;
                    self.state.focus = Focus::Content;
                }
                Some(SidebarItem::OpenStackImages) => {
                    self.state.focus = Focus::Content;
                }
                Some(SidebarItem::OpenStackCreate) => {
                    self.start_openstack_create_wizard().await;
                }
                None => {}
            },

            KeyCode::Backspace => self.exit_volume_browser(),

            KeyCode::Char('l') => {
                if let Some(id) = self
                    .state
                    .effective_openstack_instance_id()
                    .map(|s| s.to_string())
                {
                    match self.client.openstack_console_output(&id, Some(80)).await {
                        Ok(out) => {
                            self.state.log_content = format!("OpenStack console — {id}\n\n{out}");
                            self.state.content_overlay_caption =
                                " OpenStack console log (j/k:scroll  Esc:close) ".to_string();
                            self.state.scroll_offset = 0;
                            self.state.view_mode = ViewMode::Logs;
                        }
                        Err(e) => self.state.status_message = status_err("openstack console", &e),
                    }
                } else if let Some(SidebarItem::Vm(name)) =
                    self.state.selected_sidebar_item().cloned()
                {
                    self.show_vm_logs_by_name(&name).await;
                }
            }

            _ => self.handle_shared_action_key(key).await,
        }
    }

    // ── Content navigation helper ───────────────────────────────────────

    fn navigate_content(&mut self, delta: i32) {
        if self.is_showing_table() {
            let len = self.state.current_list_len();
            if len > 0 {
                if delta > 0 {
                    self.state.selected_index =
                        (self.state.selected_index + delta as usize).min(len - 1);
                } else {
                    self.state.selected_index =
                        self.state.selected_index.saturating_sub((-delta) as usize);
                }
            }
        } else if delta > 0 {
            self.state.content_scroll_offset = self
                .state
                .content_scroll_offset
                .saturating_add(delta as u16);
        } else {
            self.state.content_scroll_offset = self
                .state
                .content_scroll_offset
                .saturating_sub((-delta) as u16);
        }
    }

    // ── Content key handling ────────────────────────────────────────────

    async fn handle_content_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Char('j') | KeyCode::Down => {
                if self.is_showing_table() {
                    self.move_down();
                } else {
                    self.state.content_scroll_offset =
                        self.state.content_scroll_offset.saturating_add(1);
                }
            }
            KeyCode::Char('k') | KeyCode::Up => {
                if self.is_showing_table() {
                    self.move_up();
                } else {
                    self.state.content_scroll_offset =
                        self.state.content_scroll_offset.saturating_sub(1);
                }
            }
            KeyCode::PageDown => self.navigate_content(10),
            KeyCode::PageUp => self.navigate_content(-10),
            KeyCode::Char('g') => {
                if self.is_showing_table() {
                    self.state.selected_index = 0;
                } else {
                    self.state.content_scroll_offset = 0;
                }
            }
            KeyCode::Char('G') => {
                if self.is_showing_table() {
                    let len = self.state.current_list_len();
                    if len > 0 {
                        self.state.selected_index = len - 1;
                    }
                }
            }

            // Sub-tab cycling
            KeyCode::Tab => {
                self.state.active_object_tab = self.state.active_object_tab.next();
                self.state.content_scroll_offset = 0;
            }
            KeyCode::BackTab => {
                self.state.active_object_tab = self.state.active_object_tab.prev();
                self.state.content_scroll_offset = 0;
            }
            KeyCode::Char('1') | KeyCode::Char('2') | KeyCode::Char('3') => {
                self.state.active_object_tab = match key.code {
                    KeyCode::Char('2') => ObjectTab::Monitor,
                    KeyCode::Char('3') => ObjectTab::Configure,
                    _ => ObjectTab::Summary,
                };
                self.state.content_scroll_offset = 0;
            }

            KeyCode::Enter => match self.state.selected_sidebar_item().cloned() {
                Some(SidebarItem::Vm(name)) => {
                    if self.state.multi_select_mode {
                        self.state.toggle_selection(&name);
                    } else {
                        self.load_vm_details(&name).await;
                    }
                }
                Some(SidebarItem::StoragePool(name)) => {
                    self.browse_pool_volumes_by_name(&name).await;
                }
                Some(SidebarItem::Category(SidebarCategory::Storage)) => {
                    if let Some(name) = self.state.selected_pool_name().map(|s| s.to_string()) {
                        self.browse_pool_volumes_by_name(&name).await;
                    }
                }
                Some(SidebarItem::OpenStackInstance(id)) => {
                    self.load_openstack_instance_detail(&id).await;
                }
                Some(SidebarItem::OpenStackImages)
                | Some(SidebarItem::Category(SidebarCategory::OpenStack)) => {}
                _ => {}
            },

            KeyCode::Backspace => self.exit_volume_browser(),

            KeyCode::Char(' ') => {
                if let Some(SidebarItem::Vm(name)) = self.state.selected_sidebar_item().cloned() {
                    self.toggle_multi_select(&name);
                }
            }

            _ => self.handle_shared_action_key(key).await,
        }
    }

    // ── Shared action keys (sidebar + content + context menu) ───────────

    async fn handle_shared_action_key(&mut self, key: KeyEvent) {
        match key.code {
            // VM lifecycle actions
            KeyCode::Char('s') => self.action_on_sidebar_item("start").await,
            KeyCode::Char('x') => self.action_on_sidebar_item("stop").await,
            KeyCode::Char('H') if key.modifiers.contains(KeyModifiers::SHIFT) => {
                self.action_on_sidebar_item("shutdown").await;
            }
            KeyCode::Char('b') => self.action_on_sidebar_item("reboot").await,
            KeyCode::Char('p') => self.action_on_sidebar_item("pause").await,
            KeyCode::Char('u') => self.action_on_sidebar_item("resume").await,
            KeyCode::Char('d') => self.request_confirmation_sidebar().await,

            KeyCode::Char('n') => match self.state.sidebar_resource_view() {
                ResourceView::VirtualMachines => {
                    self.state
                        .notify_with_level(PACKER_IMAGE_HINT, NotifyLevel::Info);
                }
                ResourceView::Snapshots => {
                    self.state.input_mode = InputMode::Command;
                    self.state.command_input = "snap ".to_string();
                }
                _ => {}
            },

            // VM-specific actions (resolve name once, dispatch)
            KeyCode::Char('o') => self.with_vm(|app, name| {
                app.state.status_message = format!("Use ':clone {} <new-name>' to clone", name);
            }),
            KeyCode::Char('v') => {
                if let Some(n) = self.resolve_vm_name() {
                    self.launch_viewer_by_name(&n).await;
                }
            }
            KeyCode::Char('V') => {
                if let Some(n) = self.resolve_vm_name() {
                    self.launch_novnc_by_name(&n).await;
                }
            }
            KeyCode::Char('y') => {
                if let Some(name) = self.state.effective_network_name().map(|s| s.to_string()) {
                    let r = self.client.get_network_xml(&name).await;
                    self.show_xml_result(r, "network");
                } else if let Some(n) = self.resolve_vm_name() {
                    self.show_vm_xml_by_name(&n).await;
                }
            }
            KeyCode::Char('c') => {
                if let Some(n) = self.resolve_vm_name() {
                    self.launch_console_by_name(&n).await;
                }
            }
            KeyCode::Char('l') => {
                if let Some(id) = self
                    .state
                    .effective_openstack_instance_id()
                    .map(|s| s.to_string())
                {
                    match self.client.openstack_console_output(&id, Some(80)).await {
                        Ok(out) => {
                            self.state.log_content = format!("OpenStack console — {id}\n\n{out}");
                            self.state.content_overlay_caption =
                                " OpenStack console log (j/k:scroll  Esc:close) ".to_string();
                            self.state.scroll_offset = 0;
                            self.state.view_mode = ViewMode::Logs;
                        }
                        Err(e) => self.state.status_message = status_err("openstack console", &e),
                    }
                }
            }
            KeyCode::Char('t') => {
                if let Some(name) = self.state.effective_network_name().map(|s| s.to_string()) {
                    self.toggle_network_autostart_by_name(&name).await;
                } else if let Some(name) = self.state.effective_pool_name().map(|s| s.to_string()) {
                    self.toggle_pool_autostart_by_name(&name).await;
                } else if let Some(n) = self.resolve_vm_name() {
                    self.toggle_autostart_by_name(&n).await;
                }
            }
            KeyCode::Char('e') => {
                if let Some(n) = self.resolve_vm_name() {
                    self.launch_ssh_by_name(&n).await;
                }
            }

            // Network/pool start/stop
            KeyCode::Char('a') => self.handle_network_pool_action("start").await,
            KeyCode::Char('z') => self.handle_network_pool_action("stop").await,

            // Snapshot revert
            KeyCode::Char('R') => {
                if let Some((vm, snap)) = self.resolve_snapshot() {
                    let r = self.client.revert_snapshot(&vm, &snap).await;
                    self.report_cmd_result(
                        r,
                        &format!("Reverted '{vm}' to snapshot '{snap}'"),
                        "revert-snapshot",
                        &snap,
                        true,
                    )
                    .await;
                }
            }

            // Multi-select all
            KeyCode::Char('A') if key.modifiers.contains(KeyModifiers::SHIFT) => {
                if matches!(
                    self.state.sidebar_resource_view(),
                    ResourceView::VirtualMachines
                ) {
                    self.state.multi_select_mode = true;
                    self.state.select_all_vms();
                    self.state.status_message =
                        format!("Selected all {} VMs", self.state.selected_items.len());
                }
            }

            // Sort
            KeyCode::Char('N') if key.modifiers.contains(KeyModifiers::SHIFT) => {
                self.toggle_sort(SortColumn::Name)
            }
            KeyCode::Char('S') if key.modifiers.contains(KeyModifiers::SHIFT) => {
                if matches!(
                    self.state.sidebar_resource_view(),
                    ResourceView::VirtualMachines
                ) {
                    self.toggle_sort(SortColumn::State);
                }
            }
            KeyCode::Char('C') if key.modifiers.contains(KeyModifiers::SHIFT) => {
                self.toggle_sort(SortColumn::Cpu)
            }
            KeyCode::Char('M') if key.modifiers.contains(KeyModifiers::SHIFT) => {
                self.toggle_sort(SortColumn::Memory)
            }

            _ => {}
        }
    }

    fn is_showing_table(&self) -> bool {
        matches!(
            self.state.selected_sidebar_item(),
            Some(SidebarItem::Category(_))
        ) || self.state.command_content_override.is_some()
    }

    // ── Resource resolution helpers ─────────────────────────────────────

    fn resolve_vm_name(&self) -> Option<String> {
        self.state.effective_vm_name().map(|s| s.to_string())
    }

    fn resolve_snapshot(&self) -> Option<(String, String)> {
        self.state
            .effective_snapshot()
            .map(|s| (s.vm_name.clone(), s.name.clone()))
    }

    /// Execute a sync closure with the resolved VM name (avoids repeated resolve pattern).
    fn with_vm(&mut self, f: impl FnOnce(&mut Self, &str)) {
        if let Some(name) = self.resolve_vm_name() {
            f(self, &name);
        }
    }

    fn toggle_multi_select(&mut self, name: &str) {
        if matches!(
            self.state.sidebar_resource_view(),
            ResourceView::VirtualMachines
        ) {
            if !self.state.multi_select_mode {
                self.state.multi_select_mode = true;
            }
            self.state.toggle_selection(name);
        }
    }

    fn exit_volume_browser(&mut self) {
        if self.state.browsing_pool.is_some() {
            self.state.browsing_pool = None;
            self.state.volumes.clear();
            self.state.selected_index = 0;
        }
    }

    // ── Sidebar selection changed ───────────────────────────────────────

    async fn on_sidebar_selection_changed(&mut self) {
        self.state.content_scroll_offset = 0;
        self.state.command_content_override = None;
        self.state.resource_view = self.state.sidebar_resource_view();
        self.state.selected_index = 0;

        if let Some(SidebarItem::Vm(name)) = self.state.selected_sidebar_item().cloned() {
            if let Some(ref d) = self.state.vm_details {
                if d.name != name {
                    self.state.vm_details = None;
                }
            }
        }
        if let Some(SidebarItem::OpenStackInstance(id)) =
            self.state.selected_sidebar_item().cloned()
        {
            self.load_openstack_instance_detail(&id).await;
        } else {
            self.state.openstack_instance_detail = None;
            self.state.openstack_instance_volumes.clear();
            self.state.openstack_instance_fips.clear();
        }
    }

    fn cancel_openstack_create_wizard(&mut self) {
        self.state.openstack_create_wizard = None;
        self.state.view_mode = ViewMode::Table;
        self.state.input_mode = InputMode::Normal;
        self.state.status_message = "Create instance cancelled".to_string();
    }

    async fn start_openstack_create_wizard(&mut self) {
        if !self.state.openstack_configured() {
            self.state.status_message =
                "OpenStack not configured — add [openstack] in /etc/machina/config.toml"
                    .to_string();
            return;
        }
        self.state.status_message = "Loading OpenStack catalogs…".to_string();
        let (flavors_r, networks_r, images_r, keypairs_r) = tokio::join!(
            self.client.openstack_list_flavors(),
            self.client.openstack_list_networks(),
            self.client.openstack_list_images(),
            self.client.openstack_list_keypairs(),
        );
        let mut catalog_errors: Vec<String> = Vec::new();
        let flavors = match flavors_r {
            Ok(f) => f,
            Err(e) => {
                catalog_errors.push(status_err("flavors", &e));
                Vec::new()
            }
        };
        if flavors.is_empty() && catalog_errors.is_empty() {
            self.state.status_message = "No Nova flavors available".to_string();
            return;
        }
        if flavors.is_empty() && !catalog_errors.is_empty() {
            self.state.status_message = catalog_errors.join("; ");
            return;
        }
        let networks = match networks_r {
            Ok(n) => n,
            Err(e) => {
                catalog_errors.push(status_err("networks", &e));
                Vec::new()
            }
        };
        let images = match images_r {
            Ok(i) => i,
            Err(e) => {
                catalog_errors.push(status_err("images", &e));
                Vec::new()
            }
        };
        let keypairs = match keypairs_r {
            Ok(k) => k,
            Err(e) => {
                catalog_errors.push(status_err("keypairs", &e));
                Vec::new()
            }
        };
        if !catalog_errors.is_empty() {
            self.state.status_message = format!(
                "Catalog warnings: {} — wizard continues with partial data",
                catalog_errors.join("; ")
            );
        }
        self.state.openstack_images = images.clone();
        self.state.openstack_create_wizard = Some(OpenStackCreateWizard {
            step: OpenStackCreateStep::Name,
            name: String::new(),
            list_cursor: 0,
            flavor_idx: 0,
            image_idx: None,
            network_idx: if networks.is_empty() { None } else { Some(0) },
            key_idx: None,
            flavors,
            networks,
            images,
            keypairs,
        });
        self.state.view_mode = ViewMode::OpenStackCreate;
        self.state.input_mode = InputMode::OpenStackWizard;
        self.state.status_message = "Create instance — enter name, Enter to continue".to_string();
    }

    async fn handle_openstack_wizard_key(&mut self, key: KeyEvent) {
        let Some(wizard) = self.state.openstack_create_wizard.as_mut() else {
            self.cancel_openstack_create_wizard();
            return;
        };
        if wizard.step != OpenStackCreateStep::Name {
            return;
        }
        match key.code {
            KeyCode::Esc => self.cancel_openstack_create_wizard(),
            KeyCode::Enter => {
                if wizard.name.trim().is_empty() {
                    self.state.status_message = "Instance name is required".to_string();
                    return;
                }
                wizard.step = OpenStackCreateStep::Flavor;
                wizard.list_cursor = wizard.flavor_idx;
                self.state.input_mode = InputMode::Normal;
                self.state.status_message = "Pick flavor (j/k Enter) — Esc cancel".to_string();
            }
            KeyCode::Backspace => {
                wizard.name.pop();
            }
            KeyCode::Char(c)
                if !key
                    .modifiers
                    .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
            {
                wizard.name.push(c);
            }
            _ => {}
        }
    }

    fn wizard_step_list_len(wizard: &OpenStackCreateWizard, step: OpenStackCreateStep) -> usize {
        match step {
            OpenStackCreateStep::Flavor => wizard.flavors.len(),
            OpenStackCreateStep::Image => wizard.images.len(),
            OpenStackCreateStep::Network => wizard.networks.len(),
            OpenStackCreateStep::Keypair => wizard.keypairs.len(),
            _ => 0,
        }
    }

    fn wizard_sync_cursor(wizard: &mut OpenStackCreateWizard) {
        wizard.list_cursor = match wizard.step {
            OpenStackCreateStep::Flavor => wizard.flavor_idx,
            OpenStackCreateStep::Image => wizard.image_idx.unwrap_or(0),
            OpenStackCreateStep::Network => wizard.network_idx.unwrap_or(0),
            OpenStackCreateStep::Keypair => wizard.key_idx.unwrap_or(0),
            _ => wizard.list_cursor,
        };
    }

    fn wizard_advance_step(wizard: &mut OpenStackCreateWizard) -> OpenStackCreateStep {
        wizard.step = match wizard.step {
            OpenStackCreateStep::Name => OpenStackCreateStep::Flavor,
            OpenStackCreateStep::Flavor => OpenStackCreateStep::Image,
            OpenStackCreateStep::Image => OpenStackCreateStep::Network,
            OpenStackCreateStep::Network => OpenStackCreateStep::Keypair,
            OpenStackCreateStep::Keypair => OpenStackCreateStep::Confirm,
            OpenStackCreateStep::Confirm => OpenStackCreateStep::Confirm,
        };
        Self::wizard_sync_cursor(wizard);
        wizard.step
    }

    fn wizard_retreat_step(wizard: &mut OpenStackCreateWizard) -> OpenStackCreateStep {
        wizard.step = match wizard.step {
            OpenStackCreateStep::Confirm => OpenStackCreateStep::Keypair,
            OpenStackCreateStep::Keypair => OpenStackCreateStep::Network,
            OpenStackCreateStep::Network => OpenStackCreateStep::Image,
            OpenStackCreateStep::Image => OpenStackCreateStep::Flavor,
            OpenStackCreateStep::Flavor => OpenStackCreateStep::Name,
            OpenStackCreateStep::Name => OpenStackCreateStep::Name,
        };
        Self::wizard_sync_cursor(wizard);
        wizard.step
    }

    async fn submit_openstack_create_wizard(&mut self) {
        let Some(wizard) = self.state.openstack_create_wizard.clone() else {
            return;
        };
        let Some(flavor) = wizard.flavor_name().map(str::to_string) else {
            self.state.status_message = "Flavor is required".to_string();
            return;
        };
        let req = CreateInstanceRequest {
            name: wizard.name.trim().to_string(),
            flavor,
            image: wizard.image_name().map(str::to_string),
            boot_volume_id: None,
            boot_volume_image: None,
            boot_volume_size_gb: None,
            network: wizard.network_name().map(str::to_string),
            networks: None,
            server_group: None,
            key_name: wizard.key_name().map(str::to_string),
            availability_zone: None,
            security_groups: None,
            user_data: None,
            wait_until_active: false,
        };
        self.state.status_message = format!("Creating {}…", req.name);
        match self.client.openstack_create_instance(&req).await {
            Ok(v) => {
                self.state.status_message = format!("Created instance: {v}");
                self.cancel_openstack_create_wizard();
                self.refresh_openstack().await;
            }
            Err(e) => {
                self.state.status_message = status_err("openstack create", &e);
            }
        }
    }

    async fn handle_openstack_create_view_key(&mut self, key: KeyEvent) {
        if self.state.input_mode == InputMode::OpenStackWizard {
            return;
        }
        let Some(wizard) = self.state.openstack_create_wizard.as_mut() else {
            self.cancel_openstack_create_wizard();
            return;
        };

        match key.code {
            KeyCode::Esc => {
                self.cancel_openstack_create_wizard();
                return;
            }
            KeyCode::Backspace => {
                if wizard.step != OpenStackCreateStep::Confirm {
                    let step = Self::wizard_retreat_step(wizard);
                    if step == OpenStackCreateStep::Name {
                        self.state.input_mode = InputMode::OpenStackWizard;
                    }
                    self.state.status_message = wizard_step_hint(step);
                }
                return;
            }
            KeyCode::Char('-') | KeyCode::Char('n')
                if matches!(
                    wizard.step,
                    OpenStackCreateStep::Image | OpenStackCreateStep::Keypair
                ) =>
            {
                match wizard.step {
                    OpenStackCreateStep::Image => wizard.image_idx = None,
                    OpenStackCreateStep::Keypair => wizard.key_idx = None,
                    _ => {}
                }
                let step = Self::wizard_advance_step(wizard);
                self.state.status_message = wizard_step_hint(step);
                return;
            }
            KeyCode::Enter => match wizard.step {
                OpenStackCreateStep::Flavor => {
                    if wizard.flavors.is_empty() {
                        return;
                    }
                    wizard.flavor_idx = wizard.list_cursor.min(wizard.flavors.len() - 1);
                    let step = Self::wizard_advance_step(wizard);
                    self.state.status_message = wizard_step_hint(step);
                }
                OpenStackCreateStep::Image => {
                    if wizard.images.is_empty() {
                        wizard.image_idx = None;
                    } else {
                        wizard.image_idx = Some(wizard.list_cursor.min(wizard.images.len() - 1));
                    }
                    let step = Self::wizard_advance_step(wizard);
                    self.state.status_message = wizard_step_hint(step);
                }
                OpenStackCreateStep::Network => {
                    if wizard.networks.is_empty() {
                        self.state.status_message =
                            "No Neutron networks — fix networking or use :openstack create …"
                                .to_string();
                        return;
                    }
                    wizard.network_idx = Some(wizard.list_cursor.min(wizard.networks.len() - 1));
                    let step = Self::wizard_advance_step(wizard);
                    self.state.status_message = wizard_step_hint(step);
                }
                OpenStackCreateStep::Keypair => {
                    if wizard.keypairs.is_empty() {
                        wizard.key_idx = None;
                    } else {
                        wizard.key_idx = Some(wizard.list_cursor.min(wizard.keypairs.len() - 1));
                    }
                    let step = Self::wizard_advance_step(wizard);
                    self.state.status_message = wizard_step_hint(step);
                }
                OpenStackCreateStep::Confirm => self.submit_openstack_create_wizard().await,
                _ => {}
            },
            KeyCode::Char('j') | KeyCode::Down => {
                let len = Self::wizard_step_list_len(wizard, wizard.step);
                if len > 0 {
                    wizard.list_cursor = (wizard.list_cursor + 1) % len;
                }
            }
            KeyCode::Char('k') | KeyCode::Up => {
                let len = Self::wizard_step_list_len(wizard, wizard.step);
                if len > 0 {
                    wizard.list_cursor = if wizard.list_cursor == 0 {
                        len - 1
                    } else {
                        wizard.list_cursor - 1
                    };
                }
            }
            _ => {}
        }
    }

    async fn load_openstack_instance_detail(&mut self, id: &str) {
        let (inst, vols, fips) = tokio::join!(
            self.client.openstack_get_instance(id),
            self.client.openstack_list_instance_volumes(id),
            self.client.openstack_list_instance_floating_ips(id),
        );
        match inst {
            Ok(d) => self.state.openstack_instance_detail = Some(d),
            Err(e) => {
                self.state.status_message = status_err("openstack get", &e);
                return;
            }
        }
        self.state.openstack_instance_volumes = vols.unwrap_or_default();
        self.state.openstack_instance_fips = fips.unwrap_or_default();
    }

    async fn refresh_openstack(&mut self) {
        if let Ok(st) = self.client.openstack_status().await {
            self.state.openstack_status = Some(st);
        }
        if !self.state.openstack_configured() {
            self.state.openstack_instances.clear();
            self.state.openstack_images.clear();
            self.state.rebuild_sidebar();
            return;
        }
        if let Ok(insts) = self.client.openstack_list_instances().await {
            self.state.openstack_instances = insts;
        }
        if let Ok(imgs) = self.client.openstack_list_images().await {
            self.state.openstack_images = imgs;
        }
        self.state.rebuild_sidebar();
        self.state.clamp_selection();
    }

    fn format_openstack_status(st: &machina_core::OpenStackConnectionStatus) -> String {
        if st.compute_reachable && st.glance_reachable {
            format!(
                "OpenStack live · {} · {} instance(s), {} image(s)",
                st.cloud_name,
                st.instance_count.unwrap_or(0),
                st.image_count.unwrap_or(0)
            )
        } else if st.reachable || st.keystone_reachable {
            format!(
                "OpenStack Keystone OK · Nova/Glance: {}",
                st.error.as_deref().unwrap_or("partial")
            )
        } else if st.configured {
            format!(
                "OpenStack configured · {}",
                st.error.as_deref().unwrap_or("not connected")
            )
        } else {
            "OpenStack disabled".to_string()
        }
    }

    // ── Action dispatch ─────────────────────────────────────────────────

    async fn action_on_sidebar_item(&mut self, action: &str) {
        match self.state.selected_sidebar_item().cloned() {
            Some(SidebarItem::Vm(_))
            | Some(SidebarItem::Category(SidebarCategory::VirtualMachines)) => {
                if self.state.multi_select_mode && !self.state.selected_items.is_empty() {
                    self.batch_vm_action(action).await;
                } else if let Some(name) = self.resolve_vm_name() {
                    self.single_vm_action_by_name(action, &name).await;
                }
            }
            Some(SidebarItem::Network(name)) => {
                self.resource_action(action, "network", &name).await;
            }
            Some(SidebarItem::StoragePool(name)) => {
                self.resource_action(action, "pool", &name).await;
            }
            Some(SidebarItem::OpenStackInstance(id)) => {
                self.openstack_instance_action(action, &id).await;
            }
            _ => {}
        }
    }

    async fn openstack_instance_action(&mut self, action: &str, id: &str) {
        let r = match action {
            "start" => self.client.openstack_instance_action(id, "start").await,
            "stop" => self.client.openstack_instance_action(id, "stop").await,
            "reboot" => self.client.openstack_reboot_instance(id, false).await,
            "pause" => self.client.openstack_instance_action(id, "pause").await,
            "resume" => self.client.openstack_instance_action(id, "unpause").await,
            _ => return,
        };
        self.report_cmd_result(
            r,
            &format!("OpenStack {action} {id}"),
            &format!("openstack-{action}"),
            id,
            false,
        )
        .await;
        self.refresh_openstack().await;
    }

    /// Unified network/pool start/stop actions.
    async fn handle_network_pool_action(&mut self, action: &str) {
        if let Some(name) = self.state.effective_network_name().map(|s| s.to_string()) {
            self.resource_action(action, "network", &name).await;
        } else if let Some(name) = self.state.effective_pool_name().map(|s| s.to_string()) {
            self.resource_action(action, "pool", &name).await;
        }
    }

    /// Unified resource action (network or pool start/stop).
    async fn resource_action(&mut self, action: &str, kind: &str, name: &str) {
        let result = match (kind, action) {
            ("network", "start") => self.client.start_network(name).await,
            ("network", "stop") => self.client.stop_network(name).await,
            ("pool", "start") => self.client.start_pool(name).await,
            ("pool", "stop") => self.client.stop_pool(name).await,
            _ => return,
        };
        let kind_cap = match kind {
            "network" => "Network",
            "pool" => "Pool",
            _ => kind,
        };
        self.report_cmd_result(
            result,
            &format!("{kind_cap} '{name}': {action} OK"),
            &format!("{kind}-{action}"),
            name,
            true,
        )
        .await;
    }

    // ── Context menu ────────────────────────────────────────────────────

    async fn handle_context_menu_key(&mut self, key: KeyEvent) {
        self.state.show_context_menu = false;
        match key.code {
            KeyCode::Char('h') => self.action_on_sidebar_item("shutdown").await,
            _ => self.handle_shared_action_key(key).await,
        }
    }

    // ── Search mode ─────────────────────────────────────────────────────

    fn handle_search_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Esc => {
                self.state.input_mode = InputMode::Normal;
                self.state.search_query.clear();
                self.state.search_active = false;
                self.state.filtered_indices.clear();
                self.state.clamp_selection();
            }
            KeyCode::Enter => self.state.input_mode = InputMode::Normal,
            KeyCode::Backspace => {
                self.state.search_query.pop();
                self.state.apply_search_filter();
            }
            KeyCode::Char(c) => {
                self.state.search_query.push(c);
                self.state.apply_search_filter();
            }
            _ => {}
        }
    }

    // ── Confirmation mode ───────────────────────────────────────────────

    async fn handle_confirmation_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Char('y') => {
                self.state.input_mode = InputMode::Normal;
                if let Some(dialog) = self.state.confirm_dialog.take() {
                    self.execute_confirmed_action(&dialog.action).await;
                }
            }
            _ => {
                self.state.input_mode = InputMode::Normal;
                self.state.confirm_dialog = None;
                self.state.status_message = "Cancelled".to_string();
            }
        }
    }

    // ── Command mode ────────────────────────────────────────────────────

    async fn handle_command_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Esc => {
                self.state.input_mode = InputMode::Normal;
                self.state.command_input.clear();
            }
            KeyCode::Enter => {
                self.state.input_mode = InputMode::Normal;
                let cmd = self.state.command_input.clone();
                self.state.command_input.clear();
                self.execute_command(&cmd).await;
            }
            KeyCode::Backspace => {
                self.state.command_input.pop();
            }
            KeyCode::Char(c) => self.state.command_input.push(c),
            _ => {}
        }
    }

    // ── Mouse handling ──────────────────────────────────────────────────

    fn handle_mouse(&mut self, mouse: MouseEvent) {
        match mouse.kind {
            MouseEventKind::ScrollDown => {
                if mouse.column < self.sidebar_width {
                    if !self.state.sidebar_items.is_empty() {
                        self.state.sidebar_selected = (self.state.sidebar_selected + 1)
                            .min(self.state.sidebar_items.len() - 1);
                    }
                } else if self.is_showing_table() {
                    self.move_down();
                } else {
                    self.state.content_scroll_offset =
                        self.state.content_scroll_offset.saturating_add(1);
                }
            }
            MouseEventKind::ScrollUp => {
                if mouse.column < self.sidebar_width {
                    self.state.sidebar_selected = self.state.sidebar_selected.saturating_sub(1);
                } else if self.is_showing_table() {
                    self.move_up();
                } else {
                    self.state.content_scroll_offset =
                        self.state.content_scroll_offset.saturating_sub(1);
                }
            }
            MouseEventKind::Down(_) => {
                if mouse.column < self.sidebar_width {
                    self.state.focus = Focus::Sidebar;
                    if mouse.row > 1 {
                        let clicked = (mouse.row - 2) as usize;
                        if clicked < self.state.sidebar_items.len() {
                            self.state.sidebar_selected = clicked;
                        }
                    }
                } else {
                    self.state.focus = Focus::Content;
                    if mouse.row > 2 {
                        let clicked = (mouse.row - 3) as usize;
                        if clicked < self.state.current_list_len() {
                            self.state.selected_index = clicked;
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // ── Navigation helpers ──────────────────────────────────────────────

    fn move_down(&mut self) {
        let len = self.state.current_list_len();
        if len > 0 {
            self.state.selected_index = (self.state.selected_index + 1) % len;
        }
    }

    fn move_up(&mut self) {
        let len = self.state.current_list_len();
        if len > 0 {
            self.state.selected_index = if self.state.selected_index == 0 {
                len - 1
            } else {
                self.state.selected_index - 1
            };
        }
    }

    fn toggle_sort(&mut self, col: SortColumn) {
        if self.state.sort_column == col {
            self.state.sort_direction = self.state.sort_direction.toggle();
        } else {
            self.state.sort_column = col;
            self.state.sort_direction = SortDirection::Ascending;
        }
        self.state.sort_vms();
        self.state.rebuild_sidebar();
    }

    // ── VM client action dispatch ───────────────────────────────────────

    async fn dispatch_vm_client_action(&self, action: &str, name: &str) -> anyhow::Result<()> {
        match action {
            "start" => self.client.start_vm(name).await,
            "stop" => self.client.stop_vm(name).await,
            "shutdown" => self.client.shutdown_vm(name).await,
            "reboot" => self.client.reboot_vm(name).await,
            "pause" => self.client.pause_vm(name).await,
            "resume" => self.client.resume_vm(name).await,
            _ => Ok(()),
        }
    }

    async fn single_vm_action_by_name(&mut self, action: &str, name: &str) {
        match self.dispatch_vm_client_action(action, name).await {
            Ok(()) => {
                let msg = format!("{action}: '{name}' OK");
                self.state.status_message = msg.clone();
                self.state.notify(&msg);
                self.state.add_audit_event(action, name, "OK");
                self.refresh_vms_and_metrics().await;
            }
            Err(e) => {
                let msg = format!("Error {action} '{name}': {e}");
                self.state
                    .add_audit_event(action, name, &format!("ERROR: {e}"));
                self.state.notify(&msg);
                self.state.status_message = msg;
            }
        }
    }

    async fn batch_vm_action(&mut self, action: &str) {
        let names: Vec<String> = self.state.selected_items.iter().cloned().collect();
        let total = names.len();
        let mut ok = 0;
        let mut errors = 0;

        for name in &names {
            match self.dispatch_vm_client_action(action, name).await {
                Ok(()) => {
                    ok += 1;
                    self.state.add_audit_event(action, name, "OK");
                }
                Err(e) => {
                    errors += 1;
                    self.state
                        .add_audit_event(action, name, &format!("ERROR: {e}"));
                }
            }
        }

        self.state.status_message = format!(
            "Batch {action}: {ok}/{total} OK{}",
            if errors > 0 {
                format!(", {errors} failed")
            } else {
                String::new()
            }
        );
        self.state.clear_selection();
        self.refresh_vms_and_metrics().await;
    }

    async fn request_confirmation_sidebar(&mut self) {
        let dialog = match self.state.selected_sidebar_item().cloned() {
            Some(SidebarItem::Vm(_))
            | Some(SidebarItem::Category(SidebarCategory::VirtualMachines)) => {
                if self.state.multi_select_mode && !self.state.selected_items.is_empty() {
                    Some(self.batch_delete_dialog())
                } else {
                    self.resolve_vm_name()
                        .map(|name| Self::delete_vm_dialog(&name))
                }
            }
            Some(SidebarItem::Network(_))
            | Some(SidebarItem::Category(SidebarCategory::Networks)) => self
                .state
                .effective_network_name()
                .map(Self::delete_network_dialog),
            Some(SidebarItem::Snapshot(_, _))
            | Some(SidebarItem::Category(SidebarCategory::Snapshots)) => self
                .state
                .effective_snapshot()
                .map(|s| Self::delete_snapshot_dialog(&s.vm_name, &s.name)),
            Some(SidebarItem::StoragePool(_))
            | Some(SidebarItem::Category(SidebarCategory::Storage)) => {
                self.resolve_volume_for_delete()
            }
            Some(SidebarItem::OpenStackInstance(id)) => Some(ConfirmationDialog {
                title: "Delete OpenStack instance".to_string(),
                message: "This will delete the Nova instance.".to_string(),
                resource_name: id.clone(),
                action: format!("delete-openstack:{id}"),
            }),
            _ => None,
        };

        if let Some(d) = dialog {
            self.state.confirm_dialog = Some(d);
            self.state.input_mode = InputMode::Confirmation;
        }
    }

    fn resolve_volume_for_delete(&self) -> Option<ConfirmationDialog> {
        let pool = self.state.browsing_pool.as_ref()?;
        let vol = self.state.volumes.get(self.state.selected_index)?;
        Some(ConfirmationDialog {
            title: "Delete Volume".to_string(),
            message: format!(
                "This will permanently delete volume '{}' from pool '{}'.",
                vol.name, pool
            ),
            resource_name: format!("{}/{}", pool, vol.name),
            action: format!("delete-vol:{}:{}", pool, vol.name),
        })
    }

    fn delete_vm_dialog(name: &str) -> ConfirmationDialog {
        ConfirmationDialog {
            title: "Delete VM".to_string(),
            message: "This will permanently delete the VM and its storage.".to_string(),
            resource_name: name.to_string(),
            action: format!("delete-vm:{name}"),
        }
    }

    fn delete_network_dialog(name: &str) -> ConfirmationDialog {
        ConfirmationDialog {
            title: "Delete Network".to_string(),
            message: "This will permanently delete the network.".to_string(),
            resource_name: name.to_string(),
            action: format!("delete-network:{name}"),
        }
    }

    fn delete_snapshot_dialog(vm: &str, snap: &str) -> ConfirmationDialog {
        ConfirmationDialog {
            title: "Delete Snapshot".to_string(),
            message: "This will permanently delete the snapshot.".to_string(),
            resource_name: format!("{vm}/{snap}"),
            action: format!("delete-snap:{vm}:{snap}"),
        }
    }

    fn batch_delete_dialog(&self) -> ConfirmationDialog {
        let count = self.state.selected_items.len();
        ConfirmationDialog {
            title: "Delete VMs".to_string(),
            message: format!(
                "This will permanently delete {} VMs and their storage.",
                count
            ),
            resource_name: format!("{} selected VMs", count),
            action: format!("batch-delete-vm:{count}"),
        }
    }

    async fn execute_confirmed_action(&mut self, action: &str) {
        let parts: Vec<&str> = action.splitn(3, ':').collect();
        match parts.as_slice() {
            ["delete-vm", name] => {
                let r = self.client.delete_vm(name).await;
                if r.is_ok() {
                    self.state.vm_details = None;
                }
                self.report_cmd_result(r, &format!("Deleted VM '{name}'"), "delete", name, false)
                    .await;
                self.refresh_vms_and_metrics().await;
            }
            ["batch-delete-vm", _] => {
                let names: Vec<String> = self.state.selected_items.iter().cloned().collect();
                let total = names.len();
                let mut ok = 0;
                for name in &names {
                    match self.client.delete_vm(name).await {
                        Ok(()) => {
                            ok += 1;
                            self.state.add_audit_event("delete", name, "OK");
                        }
                        Err(e) => {
                            self.state
                                .add_audit_event("delete", name, &format!("ERROR: {e}"));
                        }
                    }
                }
                self.state.status_message = format!("Batch delete: {ok}/{total} OK");
                self.state.clear_selection();
                self.state.vm_details = None;
                self.refresh_vms_and_metrics().await;
            }
            ["delete-snap", vm_name, snap_name] => {
                let r = self.client.delete_snapshot(vm_name, snap_name).await;
                self.report_cmd_result(
                    r,
                    &format!("Deleted snapshot '{snap_name}' from '{vm_name}'"),
                    "delete-snapshot",
                    snap_name,
                    true,
                )
                .await;
            }
            ["delete-network", name] => {
                let r = self.client.delete_network(name).await;
                self.report_cmd_result(
                    r,
                    &format!("Deleted network '{name}'"),
                    "delete-network",
                    name,
                    true,
                )
                .await;
            }
            ["delete-openstack", id] => {
                let r = self.client.openstack_delete_instance(id).await;
                self.report_cmd_result(
                    r,
                    &format!("Deleted OpenStack instance {id}"),
                    "openstack-delete",
                    id,
                    true,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["delete-vol", pool, vol] => {
                let r = self.client.delete_volume(pool, vol).await;
                self.report_cmd_result(
                    r,
                    &format!("Deleted volume '{vol}' from pool '{pool}'"),
                    "delete-volume",
                    vol,
                    false,
                )
                .await;
                // Refresh volume list
                if let Some(pool_name) = self.state.browsing_pool.clone() {
                    self.browse_pool_volumes_by_name(&pool_name).await;
                }
            }
            _ => {}
        }
    }

    // ── VM detail loading ───────────────────────────────────────────────

    async fn load_vm_details(&mut self, name: &str) {
        match self.client.get_vm_details(name).await {
            Ok(details) => self.state.vm_details = Some(details),
            Err(e) => self.state.status_message = status_err("Error fetching details", &e),
        }
    }

    async fn toggle_autostart_by_name(&mut self, name: &str) {
        let current = if let Some(d) = self.state.vm_details.as_ref().filter(|d| d.name == name) {
            d.autostart
        } else {
            self.client
                .get_vm_details(name)
                .await
                .map(|d| d.autostart)
                .unwrap_or(false)
        };
        let new_val = !current;
        let label = if new_val { "enabled" } else { "disabled" };
        let r = self.client.set_autostart(name, new_val).await;
        self.report_cmd_result(
            r,
            &format!("Autostart for '{name}': {label}"),
            "autostart",
            name,
            false,
        )
        .await;
    }

    async fn toggle_network_autostart_by_name(&mut self, name: &str) {
        let current = self
            .state
            .find_network(name)
            .map(|n| n.autostart)
            .unwrap_or(false);
        let new_val = !current;
        let label = if new_val { "enabled" } else { "disabled" };
        let r = self.client.set_network_autostart(name, new_val).await;
        self.report_cmd_result(
            r,
            &format!("Autostart for network '{name}': {label}"),
            "network-autostart",
            name,
            true,
        )
        .await;
    }

    async fn toggle_pool_autostart_by_name(&mut self, name: &str) {
        let current = self
            .state
            .find_pool(name)
            .map(|p| p.autostart)
            .unwrap_or(false);
        let new_val = !current;
        let label = if new_val { "enabled" } else { "disabled" };
        let r = self.client.set_pool_autostart(name, new_val).await;
        self.report_cmd_result(
            r,
            &format!("Autostart for pool '{name}': {label}"),
            "pool-autostart",
            name,
            true,
        )
        .await;
    }

    fn show_xml_result(&mut self, result: anyhow::Result<String>, kind: &str) {
        match result {
            Ok(xml) => {
                self.state.content_overlay_caption.clear();
                self.state.xml_content = xml;
                self.state.scroll_offset = 0;
                self.state.view_mode = ViewMode::Xml;
            }
            Err(e) => {
                self.state.status_message = status_err(&format!("Error fetching {kind} XML"), &e)
            }
        }
    }

    // ── Volume browser ──────────────────────────────────────────────────

    async fn browse_pool_volumes_by_name(&mut self, pool: &str) {
        match self.client.fetch_volumes(pool).await {
            Ok(vols) => {
                self.state.volumes = vols;
                self.state.browsing_pool = Some(pool.to_string());
                self.state.selected_index = 0;
                self.state.status_message = format!(
                    "Pool '{}': {} volumes (Backspace to go back)",
                    pool,
                    self.state.volumes.len()
                );
            }
            Err(e) => self.state.status_message = status_err("Error", &e),
        }
    }

    // ── Terminal launcher helper ─────────────────────────────────────────

    fn launch_in_terminal(args: &[&str]) -> Option<String> {
        const TERMINALS: &[&str] = &[
            "gnome-terminal",
            "xfce4-terminal",
            "konsole",
            "foot",
            "alacritty",
            "kitty",
            "wezterm",
            "xterm",
        ];
        TERMINALS.iter().find_map(|term| {
            std::process::Command::new(term)
                .args(["--"])
                .args(args)
                .spawn()
                .ok()
                .map(|_| term.to_string())
        })
    }

    // ── Console / Viewer by name ───────────────────────────────────────

    async fn launch_viewer_by_name(&mut self, name: &str) {
        self.state.status_message = format!("Launching virt-viewer for '{name}'...");
        self.state.add_audit_event("virt-viewer", name, "launched");
        let _ = std::process::Command::new("virt-viewer")
            .arg("--connect")
            .arg("qemu:///system")
            .arg(name)
            .spawn();
    }

    async fn launch_console_by_name(&mut self, name: &str) {
        if let Some(term) = Self::launch_in_terminal(&["virsh", "console", name]) {
            self.state.status_message = format!("Opened console for '{name}' in {term}");
            self.state.add_audit_event("console", name, &term);
        } else {
            self.state.status_message =
                format!("No terminal found. Run manually: virsh console {name}");
        }
    }

    async fn launch_novnc_by_name(&mut self, name: &str) {
        match self.client.get_console_info(name).await {
            Ok(info) => {
                let ctype = info["console_type"].as_str().unwrap_or("unknown");
                let port = info["port"].as_i64().unwrap_or(-1);
                let ws_port = info["websocket_port"].as_i64().unwrap_or(-1);

                if port <= 0 {
                    self.state.status_message =
                        format!("No VNC/SPICE port for '{name}' (port={port})");
                    return;
                }

                let connect_port = if ws_port > 0 { ws_port } else { port };
                let novnc_url = format!("http://127.0.0.1:6080/vnc.html?host=127.0.0.1&port={connect_port}&autoconnect=true");

                if std::process::Command::new("xdg-open")
                    .arg(&novnc_url)
                    .spawn()
                    .is_ok()
                {
                    self.state.status_message =
                        format!("Opening noVNC for '{name}' ({ctype} port {connect_port})");
                } else {
                    self.state.status_message = format!("VNC for '{name}': {ctype} on 127.0.0.1:{port}. Connect with: vncviewer 127.0.0.1:{port}");
                }
                self.state
                    .add_audit_event("novnc", name, &format!("port {connect_port}"));
            }
            Err(e) => self.state.status_message = status_err("Error", &e),
        }
    }

    async fn show_vm_xml_by_name(&mut self, name: &str) {
        let r = self.client.get_vm_xml(name).await;
        self.show_xml_result(r, "VM");
    }

    async fn show_vm_logs_by_name(&mut self, name: &str) {
        let log_paths = [
            format!("/var/log/libvirt/qemu/{name}.log"),
            format!("/var/log/swtpm/libvirt/qemu/{name}-swtpm.log"),
        ];

        let mut content = String::new();
        for path in &log_paths {
            if let Ok(data) = tokio::fs::read_to_string(path).await {
                if !content.is_empty() {
                    content.push_str("\n\n");
                }
                content.push_str(&format!("\u{2500}\u{2500} {} \u{2500}\u{2500}\n", path));
                let lines: Vec<&str> = data.lines().collect();
                let start = lines.len().saturating_sub(200);
                for line in &lines[start..] {
                    content.push_str(line);
                    content.push('\n');
                }
            }
        }

        if content.is_empty() {
            content = format!("No logs found for '{name}'.\nChecked:\n");
            for path in &log_paths {
                content.push_str(&format!("  {path}\n"));
            }
        }

        self.state.content_overlay_caption.clear();
        self.state.log_content = content;
        self.state.scroll_offset = 0;
        self.state.view_mode = ViewMode::Logs;
    }

    async fn launch_ssh_by_name(&mut self, name: &str) {
        let ip = std::process::Command::new("virsh")
            .args(["domifaddr", name])
            .output()
            .ok()
            .and_then(|o| {
                String::from_utf8_lossy(&o.stdout).lines().find_map(|line| {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 4 && parts[2] == "ipv4" {
                        Some(parts[3].split('/').next().unwrap_or_default().to_string())
                    } else {
                        None
                    }
                })
            });

        if let Some(ip) = ip {
            if let Some(term) = Self::launch_in_terminal(&["ssh", &ip]) {
                self.state.status_message = format!("SSH to '{name}' ({ip}) in {term}");
                self.state.add_audit_event("ssh", name, &ip);
            } else {
                self.state.status_message = format!("SSH: ssh {ip}  (no terminal found)");
            }
        } else {
            self.state.status_message =
                format!("No IP found for '{name}'. Is it running with a network?");
        }
    }

    // ── Command execution ───────────────────────────────────────────────

    async fn report_cmd_result(
        &mut self,
        result: anyhow::Result<()>,
        ok_msg: &str,
        audit_action: &str,
        audit_target: &str,
        refresh: bool,
    ) {
        match result {
            Ok(()) => {
                self.state.status_message = ok_msg.to_string();
                self.state.add_audit_event(audit_action, audit_target, "OK");
                if refresh {
                    self.refresh_all_data().await;
                }
            }
            Err(e) => self.state.status_message = status_err("Error", &e),
        }
    }

    async fn run_browse_command(&mut self, path: &str) {
        match self.client.browse_directory(path).await {
            Ok(resp) => {
                let mut s = String::new();
                s.push_str(&format!("Directory: {}\n\n", resp.path));
                if let Some(p) = &resp.parent {
                    s.push_str(&format!("Parent: {p}\n"));
                }
                s.push_str("Roots: ");
                s.push_str(&resp.roots.join(", "));
                s.push_str("\n\n");
                for e in &resp.entries {
                    if e.is_directory {
                        s.push_str(&format!("[dir] {}\n    {}\n", e.name, e.path));
                    } else {
                        s.push_str(&format!(
                            "[file] {} ({} bytes)\n    {}\n",
                            e.name, e.size_bytes, e.path
                        ));
                    }
                }
                self.state.log_content = s;
                self.state.content_overlay_caption = " Browse (j/k:scroll  Esc:close) ".to_string();
                self.state.scroll_offset = 0;
                self.state.view_mode = ViewMode::Logs;
                self.state.add_audit_event("browse-dir", &resp.path, "OK");
            }
            Err(e) => self.state.status_message = status_err("browse", &e),
        }
    }

    fn show_json_overlay(&mut self, title: &str, v: &serde_json::Value) {
        self.state.xml_content = serde_json::to_string_pretty(v).unwrap_or_else(|_| v.to_string());
        self.state.content_overlay_caption = format!(" {title} (j/k:scroll  Esc:close) ");
        self.state.scroll_offset = 0;
        self.state.view_mode = ViewMode::Xml;
    }

    fn show_cluster_cmd_output(
        &mut self,
        title: &str,
        vm: &str,
        v: serde_json::Value,
        audit_action: &str,
    ) {
        let code = v["exit_code"].as_i64().unwrap_or(-1);
        let stdout = v["stdout"].as_str().unwrap_or("");
        let stderr = v["stderr"].as_str().unwrap_or("");
        self.state.log_content = format!(
            "{title} (VM `{vm}`)\nexit_code: {code}\n\n--- stdout ---\n{stdout}\n\n--- stderr ---\n{stderr}"
        );
        self.state.content_overlay_caption = format!(" {title} (j/k:scroll  Esc:close) ");
        self.state.scroll_offset = 0;
        self.state.view_mode = ViewMode::Logs;
        let res = if code == 0 { "OK" } else { "ERROR" };
        self.state.add_audit_event(audit_action, vm, res);
    }

    async fn execute_command(&mut self, cmd: &str) {
        let parts: Vec<&str> = cmd.split_whitespace().collect();
        match parts.as_slice() {
            ["vms"] => self.navigate_to_category(SidebarCategory::VirtualMachines),
            ["net"] | ["networks"] => self.navigate_to_category(SidebarCategory::Networks),
            ["pool"] | ["storage"] => self.navigate_to_category(SidebarCategory::Storage),
            ["snap"] | ["snapshots"] => self.navigate_to_category(SidebarCategory::Snapshots),
            ["events"] => {
                self.state.command_content_override = Some(ResourceView::Events);
                self.state.resource_view = ResourceView::Events;
            }
            ["node"] => {
                self.state.command_content_override = Some(ResourceView::Node);
                self.state.resource_view = ResourceView::Node;
                if self.state.node_info.is_none() {
                    if let Ok(info) = self.client.fetch_node_info().await {
                        self.state.node_info = Some(info);
                    }
                }
            }
            ["snap", vm, name] => {
                let r = self.client.create_snapshot(vm, name, "").await;
                self.report_cmd_result(
                    r,
                    &format!("Created snapshot '{name}' for '{vm}'"),
                    "create-snapshot",
                    name,
                    true,
                )
                .await;
            }
            ["clone", source, new_name] => {
                let r = self.client.clone_vm(source, new_name).await;
                self.report_cmd_result(
                    r,
                    &format!("Cloned '{source}' as '{new_name}'"),
                    "clone",
                    source,
                    true,
                )
                .await;
            }
            ["create"] | ["create", ..] => {
                self.state
                    .notify_with_level(PACKER_IMAGE_HINT, NotifyLevel::Info);
            }
            ["resize", name, "vcpus", count] => match count.parse::<u32>() {
                Ok(count) => {
                    let r = self.client.set_vcpus(name, count).await;
                    self.report_cmd_result(
                        r,
                        &format!("Set vCPUs for '{name}' to {count} (applies on next boot)"),
                        "resize-vcpus",
                        name,
                        false,
                    )
                    .await;
                }
                Err(_) => self.state.status_message = format!("Invalid vCPU count: '{count}'"),
            },
            ["resize", name, "memory", mb] => match mb.parse::<u64>() {
                Ok(mb) => {
                    let r = self.client.set_memory(name, mb).await;
                    self.report_cmd_result(
                        r,
                        &format!("Set memory for '{name}' to {mb} MB (applies on next boot)"),
                        "resize-memory",
                        name,
                        false,
                    )
                    .await;
                }
                Err(_) => self.state.status_message = format!("Invalid memory value: '{mb}'"),
            },
            ["rename", old_name, new_name] => {
                let r = self.client.rename_vm(old_name, new_name).await;
                self.report_cmd_result(
                    r,
                    &format!("Renamed '{old_name}' to '{new_name}'"),
                    "rename",
                    old_name,
                    true,
                )
                .await;
            }
            ["netcreate", name] => {
                let req = CreateNetworkRequest {
                    name: name.to_string(),
                    subnet: "192.168.100".to_string(),
                    dhcp_start: "192.168.100.100".to_string(),
                    dhcp_end: "192.168.100.254".to_string(),
                };
                let r = self.client.create_network(&req).await;
                self.report_cmd_result(
                    r,
                    &format!("Created network '{name}'"),
                    "create-network",
                    name,
                    true,
                )
                .await;
            }
            ["netdelete", name] => {
                let r = self.client.delete_network(name).await;
                self.report_cmd_result(
                    r,
                    &format!("Deleted network '{name}'"),
                    "delete-network",
                    name,
                    true,
                )
                .await;
            }
            ["template", ..] | ["templates"] => {
                self.state
                    .notify_with_level(PACKER_IMAGE_HINT, NotifyLevel::Info);
            }
            ["backups"] | ["backup"] => {
                self.navigate_to_category(SidebarCategory::Backups);
                if let Ok(backups) = self.client.fetch_backups().await {
                    self.state.backups = backups;
                }
            }
            ["backup", "run"] => {
                let req = machina_core::BackupRequest::default();
                let r = self.client.trigger_backup(&req).await;
                self.report_cmd_result(r, "Backup started (all VMs)", "backup", "all", false)
                    .await;
            }
            ["backup", "run", vm_name] => {
                let req = machina_core::BackupRequest {
                    vm_name: vm_name.to_string(),
                    ..Default::default()
                };
                let r = self.client.trigger_backup(&req).await;
                self.report_cmd_result(
                    r,
                    &format!("Backup started for '{vm_name}'"),
                    "backup",
                    vm_name,
                    false,
                )
                .await;
            }
            ["backup", "restore", backup_id] => {
                let r = self.client.restore_backup(backup_id).await;
                self.report_cmd_result(
                    r,
                    &format!("Restore started from '{backup_id}'"),
                    "restore",
                    backup_id,
                    true,
                )
                .await;
            }
            ["backup", "delete", backup_id] => {
                let r = self.client.delete_backup(backup_id).await;
                self.report_cmd_result(
                    r,
                    &format!("Deleted backup '{backup_id}'"),
                    "delete-backup",
                    backup_id,
                    false,
                )
                .await;
                if let Ok(backups) = self.client.fetch_backups().await {
                    self.state.backups = backups;
                }
            }
            ["openstack"] | ["os"] => match self.client.openstack_status().await {
                Ok(st) => {
                    self.state.openstack_status = Some(st.clone());
                    self.state.status_message = Self::format_openstack_status(&st);
                    self.state.rebuild_sidebar();
                }
                Err(e) => self.state.status_message = status_err("openstack status", &e),
            },
            ["openstack", "test"] | ["os", "test"] => {
                match self.client.openstack_test_connection().await {
                    Ok(st) => {
                        self.state.openstack_status = Some(st.clone());
                        self.state.status_message = Self::format_openstack_status(&st);
                        self.refresh_openstack().await;
                    }
                    Err(e) => self.state.status_message = status_err("openstack test", &e),
                }
            }
            ["openstack", "list"] | ["os", "list"] => {
                self.refresh_openstack().await;
                self.state.status_message = format!(
                    "OpenStack: {} instance(s)",
                    self.state.openstack_instances.len()
                );
                self.navigate_to_category(SidebarCategory::OpenStack);
            }
            ["openstack", "images"] | ["os", "images"] => {
                self.refresh_openstack().await;
                self.navigate_to_category(SidebarCategory::OpenStack);
                if let Some(pos) = self
                    .state
                    .sidebar_items
                    .iter()
                    .position(|i| *i == SidebarItem::OpenStackImages)
                {
                    self.state.sidebar_selected = pos;
                    self.on_sidebar_selection_changed().await;
                }
            }
            ["openstack", "flavors"] | ["os", "flavors"] => {
                match self.client.openstack_list_json("flavors").await {
                    Ok(v) => self.show_json_overlay("OpenStack flavors", &v),
                    Err(e) => self.state.status_message = status_err("openstack flavors", &e),
                }
            }
            ["openstack", "networks"] | ["os", "networks"] => {
                match self.client.openstack_list_json("networks").await {
                    Ok(v) => self.show_json_overlay("OpenStack networks", &v),
                    Err(e) => self.state.status_message = status_err("openstack networks", &e),
                }
            }
            ["openstack", "keypairs"] | ["os", "keypairs"] => {
                match self.client.openstack_list_json("keypairs").await {
                    Ok(v) => self.show_json_overlay("OpenStack keypairs", &v),
                    Err(e) => self.state.status_message = status_err("openstack keypairs", &e),
                }
            }
            ["openstack", "get", id] | ["os", "get", id] => {
                self.load_openstack_instance_detail(id).await;
                self.state.status_message = format!("Loaded OpenStack instance {id}");
            }
            ["openstack", "create"]
            | ["os", "create"]
            | ["openstack", "wizard"]
            | ["os", "wizard"] => {
                self.start_openstack_create_wizard().await;
            }
            ["openstack", "create", name, flavor] => {
                let req = CreateInstanceRequest {
                    name: name.to_string(),
                    flavor: flavor.to_string(),
                    image: None,
                    boot_volume_id: None,
                    boot_volume_image: None,
                    boot_volume_size_gb: None,
                    network: None,
                    networks: None,
                    server_group: None,
                    key_name: None,
                    availability_zone: None,
                    security_groups: None,
                    user_data: None,
                    wait_until_active: false,
                };
                match self.client.openstack_create_instance(&req).await {
                    Ok(v) => {
                        self.state.status_message = format!("Created instance: {v}");
                        self.refresh_openstack().await;
                    }
                    Err(e) => self.state.status_message = status_err("openstack create", &e),
                }
            }
            ["openstack", "create", name, flavor, image] => {
                let req = CreateInstanceRequest {
                    name: name.to_string(),
                    flavor: flavor.to_string(),
                    image: Some(image.to_string()),
                    boot_volume_id: None,
                    boot_volume_image: None,
                    boot_volume_size_gb: None,
                    network: None,
                    networks: None,
                    server_group: None,
                    key_name: None,
                    availability_zone: None,
                    security_groups: None,
                    user_data: None,
                    wait_until_active: false,
                };
                match self.client.openstack_create_instance(&req).await {
                    Ok(v) => {
                        self.state.status_message = format!("Created instance: {v}");
                        self.refresh_openstack().await;
                    }
                    Err(e) => self.state.status_message = status_err("openstack create", &e),
                }
            }
            ["openstack", "start", id] | ["os", "start", id] => {
                let r = self.client.openstack_instance_action(id, "start").await;
                self.report_cmd_result(
                    r,
                    &format!("Started OpenStack instance {id}"),
                    "openstack-start",
                    id,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "stop", id] | ["os", "stop", id] => {
                let r = self.client.openstack_instance_action(id, "stop").await;
                self.report_cmd_result(
                    r,
                    &format!("Stopped OpenStack instance {id}"),
                    "openstack-stop",
                    id,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "reboot", id] | ["os", "reboot", id] => {
                let r = self.client.openstack_reboot_instance(id, false).await;
                self.report_cmd_result(
                    r,
                    &format!("Rebooted OpenStack instance {id}"),
                    "openstack-reboot",
                    id,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "pause", id] => {
                let r = self.client.openstack_instance_action(id, "pause").await;
                self.report_cmd_result(r, &format!("Paused {id}"), "openstack-pause", id, false)
                    .await;
                self.refresh_openstack().await;
            }
            ["openstack", "unpause", id] | ["openstack", "resume", id] => {
                let r = self.client.openstack_instance_action(id, "unpause").await;
                self.report_cmd_result(r, &format!("Resumed {id}"), "openstack-resume", id, false)
                    .await;
                self.refresh_openstack().await;
            }
            ["openstack", "suspend", id] => {
                let r = self.client.openstack_instance_action(id, "suspend").await;
                self.report_cmd_result(
                    r,
                    &format!("Suspended {id}"),
                    "openstack-suspend",
                    id,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "snapshot", id, image_name] => {
                let r = self
                    .client
                    .openstack_snapshot_instance(id, image_name)
                    .await;
                self.report_cmd_result(
                    r,
                    &format!("Snapshot {id} → {image_name}"),
                    "openstack-snapshot",
                    id,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "quotas"] | ["os", "quotas"] => {
                match self.client.openstack_get_quotas().await {
                    Ok(q) => self.show_json_overlay("OpenStack quotas", &q),
                    Err(e) => self.state.status_message = status_err("openstack quotas", &e),
                }
            }
            ["openstack", "snapshots"] | ["os", "snapshots"] => {
                match self.client.openstack_list_volume_snapshots().await {
                    Ok(s) => self.show_json_overlay("Cinder snapshots", &s),
                    Err(e) => self.state.status_message = status_err("openstack snapshots", &e),
                }
            }
            ["openstack", "confirm-resize", id] => {
                let r = self.client.openstack_confirm_resize(id).await;
                self.report_cmd_result(
                    r,
                    &format!("Confirmed resize {id}"),
                    "openstack-confirm-resize",
                    id,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "revert-resize", id] => {
                let r = self.client.openstack_revert_resize(id).await;
                self.report_cmd_result(
                    r,
                    &format!("Reverted resize {id}"),
                    "openstack-revert-resize",
                    id,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "resize", id, flavor] => {
                let r = self
                    .client
                    .openstack_resize_instance(id, flavor, true)
                    .await;
                self.report_cmd_result(
                    r,
                    &format!("Resize {id} → {flavor}"),
                    "openstack-resize",
                    id,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "console", id] => {
                match self.client.openstack_remote_console(id, "novnc").await {
                    Ok(c) => {
                        self.state.log_content =
                            format!("OpenStack noVNC console — {id}\n\nURL:\n{}\n", c.url);
                        self.state.content_overlay_caption =
                            " OpenStack console URL (j/k:scroll  Esc:close) ".to_string();
                        self.state.scroll_offset = 0;
                        self.state.view_mode = ViewMode::Logs;
                    }
                    Err(e) => self.state.status_message = status_err("openstack console", &e),
                }
            }
            ["openstack", "export", id] => match self
                .client
                .openstack_export_instance(id, &serde_json::json!({}))
                .await
            {
                Ok(v) => self.show_json_overlay("OpenStack export plan", &v),
                Err(e) => self.state.status_message = status_err("openstack export", &e),
            },
            ["openstack", "image-delete", id] | ["openstack", "delete-image", id] => {
                let r = self.client.openstack_delete_image(id).await;
                self.report_cmd_result(
                    r,
                    &format!("Deleted Glance image {id}"),
                    "openstack-image-delete",
                    id,
                    true,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "delete", id] | ["os", "delete", id] => {
                let r = self.client.openstack_delete_instance(id).await;
                self.report_cmd_result(
                    r,
                    &format!("Deleted OpenStack instance {id}"),
                    "openstack-delete",
                    id,
                    true,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "nav"] | ["os", "nav"] => {
                self.navigate_to_category(SidebarCategory::OpenStack);
            }
            ["openstack", "volumes"] | ["os", "volumes"] => {
                match self.client.openstack_list_cinder_volumes().await {
                    Ok(vols) => {
                        self.state.openstack_cinder_volumes = vols.clone();
                        self.state.status_message = format!(
                            "Cinder: {} volume(s) — :openstack volumes-json for list",
                            vols.len()
                        );
                    }
                    Err(e) => self.state.status_message = status_err("openstack volumes", &e),
                }
            }
            ["openstack", "volumes-json"] => {
                match self.client.openstack_list_cinder_volumes().await {
                    Ok(vols) => {
                        self.state.openstack_cinder_volumes = vols.clone();
                        self.show_json_overlay(
                            "Cinder volumes",
                            &serde_json::json!({ "volumes": vols }),
                        );
                    }
                    Err(e) => self.state.status_message = status_err("openstack volumes", &e),
                }
            }
            ["openstack", "instance-volumes", id] | ["os", "instance-volumes", id] => {
                match self.client.openstack_list_instance_volumes(id).await {
                    Ok(vols) => {
                        self.state.openstack_instance_volumes = vols.clone();
                        self.show_json_overlay(
                            &format!("Volumes on {id}"),
                            &serde_json::json!({ "volumes": vols }),
                        );
                    }
                    Err(e) => {
                        self.state.status_message = status_err("openstack instance-volumes", &e)
                    }
                }
            }
            ["openstack", "attach", inst, vol] => {
                let r = self.client.openstack_attach_volume(inst, vol).await;
                self.report_cmd_result(
                    r,
                    &format!("Attached {vol} → {inst}"),
                    "openstack-attach",
                    inst,
                    false,
                )
                .await;
                self.load_openstack_instance_detail(inst).await;
            }
            ["openstack", "detach", inst, vol] => {
                let r = self.client.openstack_detach_volume(inst, vol).await;
                self.report_cmd_result(
                    r,
                    &format!("Detached {vol} from {inst}"),
                    "openstack-detach",
                    inst,
                    false,
                )
                .await;
                self.load_openstack_instance_detail(inst).await;
            }
            ["openstack", "fips"] | ["os", "fips"] => {
                match self.client.openstack_list_floating_ips().await {
                    Ok(fips) => self.show_json_overlay(
                        "Floating IPs",
                        &serde_json::json!({ "floating_ips": fips }),
                    ),
                    Err(e) => self.state.status_message = status_err("openstack fips", &e),
                }
            }
            ["openstack", "instance-fips", id] => {
                match self.client.openstack_list_instance_floating_ips(id).await {
                    Ok(fips) => {
                        self.state.openstack_instance_fips = fips.clone();
                        self.show_json_overlay(
                            &format!("FIPs on {id}"),
                            &serde_json::json!({ "floating_ips": fips }),
                        );
                    }
                    Err(e) => self.state.status_message = status_err("openstack instance-fips", &e),
                }
            }
            ["openstack", "fip-associate", inst, fip_id] => {
                let body = AssociateFloatingIpRequest {
                    floating_ip_id: Some(fip_id.to_string()),
                    floating_network: None,
                };
                let r = self
                    .client
                    .openstack_associate_floating_ip(inst, &body)
                    .await;
                self.report_cmd_result(
                    r,
                    &format!("Associated FIP {fip_id} → {inst}"),
                    "openstack-fip",
                    inst,
                    false,
                )
                .await;
                self.load_openstack_instance_detail(inst).await;
            }
            ["openstack", "fip-new", inst, network_id] => {
                let body = AssociateFloatingIpRequest {
                    floating_ip_id: None,
                    floating_network: Some(network_id.to_string()),
                };
                let r = self
                    .client
                    .openstack_associate_floating_ip(inst, &body)
                    .await;
                self.report_cmd_result(
                    r,
                    &format!("Allocated FIP on network {network_id} → {inst}"),
                    "openstack-fip-new",
                    inst,
                    false,
                )
                .await;
                self.load_openstack_instance_detail(inst).await;
            }
            ["openstack", "fip-dissociate", fip_id] => {
                let r = self.client.openstack_dissociate_floating_ip(fip_id).await;
                self.report_cmd_result(
                    r,
                    &format!("Dissociated FIP {fip_id}"),
                    "openstack-fip-dissoc",
                    fip_id,
                    false,
                )
                .await;
            }
            ["openstack", "fip-allocate", net] | ["os", "fip-allocate", net] => {
                match self.client.openstack_allocate_floating_ip(net).await {
                    Ok(fip) => {
                        self.state.status_message =
                            format!("Allocated FIP {} ({})", fip.address, fip.id);
                    }
                    Err(e) => self.state.status_message = status_err("openstack fip-allocate", &e),
                }
            }
            ["openstack", "fip-release", fip_id] | ["os", "fip-release", fip_id] => {
                let r = self.client.openstack_delete_floating_ip(fip_id).await;
                self.report_cmd_result(
                    r,
                    &format!("Released FIP {fip_id}"),
                    "openstack-fip-release",
                    fip_id,
                    true,
                )
                .await;
            }
            ["openstack", "port-delete", port_id] => {
                let r = self.client.openstack_delete_port(port_id).await;
                self.report_cmd_result(
                    r,
                    &format!("Deleted port {port_id}"),
                    "openstack-port-delete",
                    port_id,
                    true,
                )
                .await;
            }
            ["openstack", "az"] | ["os", "az"] => {
                match self.client.openstack_list_json("availability-zones").await {
                    Ok(v) => self.show_json_overlay("Availability zones", &v),
                    Err(e) => self.state.status_message = status_err("openstack az", &e),
                }
            }
            ["openstack", "hypervisors"] | ["os", "hypervisors"] => {
                match self.client.openstack_list_json("hypervisors").await {
                    Ok(v) => self.show_json_overlay("Hypervisors", &v),
                    Err(e) => self.state.status_message = status_err("openstack hypervisors", &e),
                }
            }
            ["openstack", "aggregates"] | ["os", "aggregates"] => {
                match self.client.openstack_list_json("aggregates").await {
                    Ok(v) => self.show_json_overlay("Host aggregates", &v),
                    Err(e) => self.state.status_message = status_err("openstack aggregates", &e),
                }
            }
            ["openstack", "compute-services"] | ["os", "compute-services"] => {
                match self.client.openstack_list_json("compute-services").await {
                    Ok(v) => self.show_json_overlay("Compute services", &v),
                    Err(e) => {
                        self.state.status_message = status_err("openstack compute-services", &e)
                    }
                }
            }
            ["openstack", "neutron-agents"] | ["os", "neutron-agents"] => {
                match self.client.openstack_list_json("neutron-agents").await {
                    Ok(v) => self.show_json_overlay("Neutron agents", &v),
                    Err(e) => {
                        self.state.status_message = status_err("openstack neutron-agents", &e)
                    }
                }
            }
            ["openstack", "server-groups"] | ["os", "server-groups"] => {
                match self.client.openstack_list_json("server-groups").await {
                    Ok(v) => self.show_json_overlay("Server groups", &v),
                    Err(e) => self.state.status_message = status_err("openstack server-groups", &e),
                }
            }
            ["openstack", "force-delete", id] | ["os", "force-delete", id] => {
                let r = self.client.openstack_force_delete_instance(id).await;
                self.report_cmd_result(
                    r,
                    &format!("Force-deleted {id}"),
                    "openstack-force-delete",
                    id,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "sg-delete", id] | ["os", "sg-delete", id] => {
                let r = self.client.openstack_delete_server_group(id).await;
                self.report_cmd_result(
                    r,
                    &format!("Deleted server group {id}"),
                    "openstack-sg-delete",
                    id,
                    true,
                )
                .await;
            }
            ["openstack", "vol-from-image", image_id, name] => {
                let r = self
                    .client
                    .openstack_create_volume_from_image(image_id, Some(name), None)
                    .await;
                self.report_cmd_result(
                    r,
                    &format!("Volume from image {image_id}"),
                    "openstack-vol-from-image",
                    image_id,
                    false,
                )
                .await;
            }
            ["openstack", "clouds"] | ["os", "clouds"] => {
                match self.client.openstack_list_json("clouds").await {
                    Ok(v) => self.show_json_overlay("Clouds", &v),
                    Err(e) => self.state.status_message = status_err("openstack clouds", &e),
                }
            }
            ["openstack", "cloud", name] | ["os", "cloud", name] => {
                let r = self.client.openstack_select_cloud(name).await;
                self.report_cmd_result(
                    r,
                    &format!("Switched to cloud {name}"),
                    "openstack-cloud",
                    name,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "volume", id] | ["os", "volume", id] => {
                match self
                    .client
                    .openstack_get_json(&format!("volumes/{id}"))
                    .await
                {
                    Ok(v) => self.show_json_overlay(&format!("Volume {id}"), &v),
                    Err(e) => self.state.status_message = status_err("openstack volume", &e),
                }
            }
            ["openstack", "image", id] | ["os", "image", id] => {
                match self
                    .client
                    .openstack_get_json(&format!("images/{id}"))
                    .await
                {
                    Ok(v) => self.show_json_overlay(&format!("Image {id}"), &v),
                    Err(e) => self.state.status_message = status_err("openstack image", &e),
                }
            }
            ["openstack", "fip", id] | ["os", "fip", id] => {
                match self
                    .client
                    .openstack_get_json(&format!("floating-ips/{id}"))
                    .await
                {
                    Ok(v) => self.show_json_overlay(&format!("FIP {id}"), &v),
                    Err(e) => self.state.status_message = status_err("openstack fip", &e),
                }
            }
            ["openstack", "snapshot", id] | ["os", "snapshot", id] => {
                match self
                    .client
                    .openstack_get_json(&format!("volume-snapshots/{id}"))
                    .await
                {
                    Ok(v) => self.show_json_overlay(&format!("Snapshot {id}"), &v),
                    Err(e) => self.state.status_message = status_err("openstack snapshot", &e),
                }
            }
            ["openstack", "hypervisor", id] | ["os", "hypervisor", id] => {
                match self
                    .client
                    .openstack_get_json(&format!("hypervisors/{id}"))
                    .await
                {
                    Ok(v) => self.show_json_overlay(&format!("Hypervisor {id}"), &v),
                    Err(e) => self.state.status_message = status_err("openstack hypervisor", &e),
                }
            }
            ["openstack", "network", id] | ["os", "network", id] => {
                match self
                    .client
                    .openstack_get_json(&format!("networks/{id}"))
                    .await
                {
                    Ok(v) => self.show_json_overlay(&format!("Network {id}"), &v),
                    Err(e) => self.state.status_message = status_err("openstack network", &e),
                }
            }
            ["openstack", "subnet", id] | ["os", "subnet", id] => {
                match self
                    .client
                    .openstack_get_json(&format!("subnets/{id}"))
                    .await
                {
                    Ok(v) => self.show_json_overlay(&format!("Subnet {id}"), &v),
                    Err(e) => self.state.status_message = status_err("openstack subnet", &e),
                }
            }
            ["openstack", "router", id] | ["os", "router", id] => {
                match self
                    .client
                    .openstack_get_json(&format!("routers/{id}"))
                    .await
                {
                    Ok(v) => self.show_json_overlay(&format!("Router {id}"), &v),
                    Err(e) => self.state.status_message = status_err("openstack router", &e),
                }
            }
            ["openstack", "port", id] | ["os", "port", id] => {
                match self.client.openstack_get_json(&format!("ports/{id}")).await {
                    Ok(v) => self.show_json_overlay(&format!("Port {id}"), &v),
                    Err(e) => self.state.status_message = status_err("openstack port", &e),
                }
            }
            ["openstack", "server-group", id] | ["os", "server-group", id] => {
                match self
                    .client
                    .openstack_get_json(&format!("server-groups/{id}"))
                    .await
                {
                    Ok(v) => self.show_json_overlay(&format!("Server group {id}"), &v),
                    Err(e) => self.state.status_message = status_err("openstack server-group", &e),
                }
            }
            ["openstack", "rename", id, name] => {
                let r = self.client.openstack_rename_instance(id, name).await;
                self.report_cmd_result(
                    r,
                    &format!("Renamed {id} → {name}"),
                    "openstack-rename",
                    id,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "lock", id] => {
                let r = self.client.openstack_lock_instance(id).await;
                self.report_cmd_result(r, &format!("Locked {id}"), "openstack-lock", id, false)
                    .await;
            }
            ["openstack", "unlock", id] => {
                let r = self.client.openstack_unlock_instance(id).await;
                self.report_cmd_result(r, &format!("Unlocked {id}"), "openstack-unlock", id, false)
                    .await;
            }
            ["openstack", "sg-add", inst, sg] => {
                let r = self.client.openstack_add_security_group(inst, sg).await;
                self.report_cmd_result(
                    r,
                    &format!("Added SG {sg} → {inst}"),
                    "openstack-sg-add",
                    inst,
                    false,
                )
                .await;
                self.load_openstack_instance_detail(inst).await;
            }
            ["openstack", "sg-remove", inst, sg] => {
                let r = self.client.openstack_remove_security_group(inst, sg).await;
                self.report_cmd_result(
                    r,
                    &format!("Removed SG {sg} from {inst}"),
                    "openstack-sg-remove",
                    inst,
                    false,
                )
                .await;
                self.load_openstack_instance_detail(inst).await;
            }
            ["openstack", "reboot-soft", id] | ["os", "reboot-soft", id] => {
                let r = self.client.openstack_reboot_instance(id, true).await;
                self.report_cmd_result(
                    r,
                    &format!("Soft-rebooted {id}"),
                    "openstack-reboot-soft",
                    id,
                    false,
                )
                .await;
            }
            ["openstack", "migrate", id] | ["os", "migrate", id] => {
                let r = self
                    .client
                    .openstack_migrate_instance(id, false, None)
                    .await;
                self.report_cmd_result(
                    r,
                    &format!("Migrated {id}"),
                    "openstack-migrate",
                    id,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "migrate-live", id] | ["os", "migrate-live", id] => {
                let r = self.client.openstack_migrate_instance(id, true, None).await;
                self.report_cmd_result(
                    r,
                    &format!("Live-migrated {id}"),
                    "openstack-migrate-live",
                    id,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "backup", id, name] | ["os", "backup", id, name] => {
                let r = self.client.openstack_backup_instance(id, name).await;
                self.report_cmd_result(
                    r,
                    &format!("Backup {id} → {name}"),
                    "openstack-backup",
                    id,
                    false,
                )
                .await;
            }
            ["openstack", "rebuild", id, image] | ["os", "rebuild", id, image] => {
                let r = self.client.openstack_rebuild_instance(id, image).await;
                self.report_cmd_result(
                    r,
                    &format!("Rebuild {id} from {image}"),
                    "openstack-rebuild",
                    id,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "shelve", id] | ["os", "shelve", id] => {
                let r = self.client.openstack_shelve_instance(id).await;
                self.report_cmd_result(r, &format!("Shelved {id}"), "openstack-shelve", id, false)
                    .await;
                self.refresh_openstack().await;
            }
            ["openstack", "unshelve", id] | ["os", "unshelve", id] => {
                let r = self.client.openstack_unshelve_instance(id).await;
                self.report_cmd_result(
                    r,
                    &format!("Unshelved {id}"),
                    "openstack-unshelve",
                    id,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "rescue", id] => {
                let r = self.client.openstack_rescue_instance(id, None).await;
                self.report_cmd_result(r, &format!("Rescue {id}"), "openstack-rescue", id, false)
                    .await;
                self.refresh_openstack().await;
            }
            ["openstack", "rescue", id, image] => {
                let r = self.client.openstack_rescue_instance(id, Some(image)).await;
                self.report_cmd_result(
                    r,
                    &format!("Rescue {id} with {image}"),
                    "openstack-rescue",
                    id,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "unrescue", id] | ["os", "unrescue", id] => {
                let r = self.client.openstack_unrescue_instance(id).await;
                self.report_cmd_result(
                    r,
                    &format!("Unrescued {id}"),
                    "openstack-unrescue",
                    id,
                    false,
                )
                .await;
                self.refresh_openstack().await;
            }
            ["openstack", "interfaces", id] | ["os", "interfaces", id] => {
                match self.client.openstack_list_instance_interfaces(id).await {
                    Ok(v) => self.show_json_overlay(&format!("Interfaces on {id}"), &v),
                    Err(e) => self.state.status_message = status_err("openstack interfaces", &e),
                }
            }
            ["openstack", "interface-attach", id, net] | ["os", "interface-attach", id, net] => {
                let r = self.client.openstack_attach_interface(id, net).await;
                self.report_cmd_result(
                    r,
                    &format!("Attached {net} → {id}"),
                    "openstack-if-attach",
                    id,
                    false,
                )
                .await;
            }
            ["openstack", "interface-detach", id, port] | ["os", "interface-detach", id, port] => {
                let r = self.client.openstack_detach_interface(id, port).await;
                self.report_cmd_result(
                    r,
                    &format!("Detached port {port} from {id}"),
                    "openstack-if-detach",
                    id,
                    false,
                )
                .await;
            }
            ["openstack", "vol-upload-image", vol, name]
            | ["os", "vol-upload-image", vol, name] => {
                let r = self.client.openstack_upload_volume_image(vol, name).await;
                self.report_cmd_result(
                    r,
                    &format!("Upload volume {vol} → Glance {name}"),
                    "openstack-vol-upload",
                    vol,
                    false,
                )
                .await;
            }
            ["openstack", "subnet-update", id, field, value]
            | ["os", "subnet-update", id, field, value] => {
                let r = self.client.openstack_update_subnet(id, field, value).await;
                self.report_cmd_result(
                    r,
                    &format!("Subnet {id} {field}={value}"),
                    "openstack-subnet-update",
                    id,
                    false,
                )
                .await;
            }
            ["openstack", "port-update", id, field, value]
            | ["os", "port-update", id, field, value] => {
                let r = self.client.openstack_update_port(id, field, value).await;
                self.report_cmd_result(
                    r,
                    &format!("Port {id} {field}={value}"),
                    "openstack-port-update",
                    id,
                    false,
                )
                .await;
            }
            ["openstack", "flavor-create", name, vcpus, ram, disk]
            | ["os", "flavor-create", name, vcpus, ram, disk] => {
                let r = self
                    .client
                    .openstack_create_flavor(
                        name,
                        vcpus.parse().unwrap_or(1),
                        ram.parse().unwrap_or(2048),
                        disk.parse().unwrap_or(20),
                    )
                    .await;
                self.report_cmd_result(
                    r,
                    &format!("Created flavor {name}"),
                    "openstack-flavor-create",
                    name,
                    false,
                )
                .await;
            }
            ["openstack", "flavor-delete", id] | ["os", "flavor-delete", id] => {
                let r = self.client.openstack_delete_flavor(id).await;
                self.report_cmd_result(
                    r,
                    &format!("Deleted flavor {id}"),
                    "openstack-flavor-delete",
                    id,
                    false,
                )
                .await;
            }
            ["openstack", "quota-set", service, key, limit]
            | ["os", "quota-set", service, key, limit] => {
                let r = self
                    .client
                    .openstack_update_quotas(service, key, limit.parse().unwrap_or(-1))
                    .await;
                self.report_cmd_result(
                    r,
                    &format!("Quota {service}.{key}={limit}"),
                    "openstack-quota-set",
                    service,
                    false,
                )
                .await;
            }
            ["openstack", "svc-enable", binary, host] | ["os", "svc-enable", binary, host] => {
                let r = self
                    .client
                    .openstack_set_compute_service(binary, host, true)
                    .await;
                self.report_cmd_result(
                    r,
                    &format!("Enabled {binary}@{host}"),
                    "openstack-svc-enable",
                    host,
                    false,
                )
                .await;
            }
            ["openstack", "svc-disable", binary, host] | ["os", "svc-disable", binary, host] => {
                let r = self
                    .client
                    .openstack_set_compute_service(binary, host, false)
                    .await;
                self.report_cmd_result(
                    r,
                    &format!("Disabled {binary}@{host}"),
                    "openstack-svc-disable",
                    host,
                    false,
                )
                .await;
            }
            ["openstack", "agent-admin", id, state] | ["os", "agent-admin", id, state] => {
                let up = matches!(
                    state.to_lowercase().as_str(),
                    "up" | "1" | "true" | "on" | "yes"
                );
                let r = self.client.openstack_set_agent_admin(id, up).await;
                self.report_cmd_result(
                    r,
                    &format!("Agent {id} admin={state}"),
                    "openstack-agent-admin",
                    id,
                    false,
                )
                .await;
            }
            ["openstack", "hv-maintenance", id, state] | ["os", "hv-maintenance", id, state] => {
                let on = matches!(state.to_lowercase().as_str(), "on" | "1" | "true" | "yes");
                let r = self.client.openstack_set_hv_maintenance(id, on).await;
                self.report_cmd_result(
                    r,
                    &format!("Hypervisor {id} maintenance={state}"),
                    "openstack-hv-maint",
                    id,
                    false,
                )
                .await;
            }
            ["openstack", "aggregate-create", name] | ["os", "aggregate-create", name] => {
                let r = self.client.openstack_create_aggregate(name, None).await;
                self.report_cmd_result(
                    r,
                    &format!("Created aggregate {name}"),
                    "openstack-agg-create",
                    name,
                    false,
                )
                .await;
            }
            ["openstack", "aggregate-create", name, az] | ["os", "aggregate-create", name, az] => {
                let r = self.client.openstack_create_aggregate(name, Some(az)).await;
                self.report_cmd_result(
                    r,
                    &format!("Created aggregate {name}"),
                    "openstack-agg-create",
                    name,
                    false,
                )
                .await;
            }
            ["openstack", "aggregate-add-host", id, host]
            | ["os", "aggregate-add-host", id, host] => {
                let r = self.client.openstack_aggregate_add_host(id, host).await;
                self.report_cmd_result(
                    r,
                    &format!("Added {host} → aggregate {id}"),
                    "openstack-agg-add",
                    id,
                    false,
                )
                .await;
            }
            ["openstack", "aggregate-remove-host", id, host]
            | ["os", "aggregate-remove-host", id, host] => {
                let r = self.client.openstack_aggregate_remove_host(id, host).await;
                self.report_cmd_result(
                    r,
                    &format!("Removed {host} from aggregate {id}"),
                    "openstack-agg-rm",
                    id,
                    false,
                )
                .await;
            }
            ["openstack", "heat-stacks"] | ["os", "heat-stacks"] => {
                match self.client.openstack_api_get("heat/stacks").await {
                    Ok(v) => self.show_json_overlay("Heat stacks", &v),
                    Err(e) => self.state.status_message = status_err("openstack heat-stacks", &e),
                }
            }
            ["openstack", "heat-events", name, id] | ["os", "heat-events", name, id] => {
                let path = format!("heat/stacks/{name}/{id}/events");
                match self.client.openstack_api_get(&path).await {
                    Ok(v) => self.show_json_overlay(&format!("Heat events {name}"), &v),
                    Err(e) => self.state.status_message = status_err("openstack heat-events", &e),
                }
            }
            ["openstack", "heat-resources", name, id] | ["os", "heat-resources", name, id] => {
                let path = format!("heat/stacks/{name}/{id}/resources");
                match self.client.openstack_api_get(&path).await {
                    Ok(v) => self.show_json_overlay(&format!("Heat resources {name}"), &v),
                    Err(e) => {
                        self.state.status_message = status_err("openstack heat-resources", &e)
                    }
                }
            }
            ["openstack", "lb-listeners", lb] | ["os", "lb-listeners", lb] => {
                let path = format!("load-balancers/{lb}/listeners");
                match self.client.openstack_api_get(&path).await {
                    Ok(v) => self.show_json_overlay(&format!("LB listeners {lb}"), &v),
                    Err(e) => self.state.status_message = status_err("openstack lb-listeners", &e),
                }
            }
            ["openstack", "identity-roles"] | ["os", "identity-roles"] => {
                match self.client.openstack_api_get("identity/roles").await {
                    Ok(v) => self.show_json_overlay("Keystone roles", &v),
                    Err(e) => {
                        self.state.status_message = status_err("openstack identity-roles", &e)
                    }
                }
            }
            ["openstack", "identity-assignments", project]
            | ["os", "identity-assignments", project] => {
                let path = format!("identity/role-assignments?project_id={project}");
                match self.client.openstack_api_get(&path).await {
                    Ok(v) => self.show_json_overlay(&format!("Role assignments {project}"), &v),
                    Err(e) => {
                        self.state.status_message = status_err("openstack identity-assignments", &e)
                    }
                }
            }
            ["openstack", "create", name, flavor, image, network] => {
                let req = CreateInstanceRequest {
                    name: name.to_string(),
                    flavor: flavor.to_string(),
                    image: Some(image.to_string()),
                    boot_volume_id: None,
                    boot_volume_image: None,
                    boot_volume_size_gb: None,
                    network: Some(network.to_string()),
                    networks: None,
                    server_group: None,
                    key_name: None,
                    availability_zone: None,
                    security_groups: None,
                    user_data: None,
                    wait_until_active: false,
                };
                match self.client.openstack_create_instance(&req).await {
                    Ok(v) => {
                        self.state.status_message = format!("Created instance: {v}");
                        self.refresh_openstack().await;
                    }
                    Err(e) => self.state.status_message = status_err("openstack create", &e),
                }
            }
            ["kubevirt-bundle", vm] => match self.client.get_kubevirt_bundle_yaml(vm).await {
                Ok(yaml) => {
                    self.state.xml_content = yaml;
                    self.state.content_overlay_caption =
                        format!(" KubeVirt YAML — {vm} (j/k:scroll  Esc:close) ");
                    self.state.scroll_offset = 0;
                    self.state.view_mode = ViewMode::Xml;
                    self.state.add_audit_event("kubevirt-bundle", vm, "OK");
                }
                Err(e) => self.state.status_message = status_err("kubevirt-bundle", &e),
            },
            ["kubevirt-apply", vm] => {
                match self
                    .client
                    .kubevirt_cluster_exec(vm, "apply", &serde_json::json!({}))
                    .await
                {
                    Ok(v) => self.show_cluster_cmd_output("kubectl apply", vm, v, "kubevirt-apply"),
                    Err(e) => self.state.status_message = status_err("kubevirt-apply", &e),
                }
            }
            ["kubevirt-upload", vm] => {
                match self
                    .client
                    .kubevirt_cluster_exec(vm, "upload", &serde_json::json!({}))
                    .await
                {
                    Ok(v) => self.show_cluster_cmd_output(
                        "virtctl image-upload",
                        vm,
                        v,
                        "kubevirt-upload",
                    ),
                    Err(e) => self.state.status_message = status_err("kubevirt-upload", &e),
                }
            }
            ["kubevirt-start", vm] => {
                match self
                    .client
                    .kubevirt_cluster_exec(vm, "start", &serde_json::json!({}))
                    .await
                {
                    Ok(v) => self.show_cluster_cmd_output("virtctl start", vm, v, "kubevirt-start"),
                    Err(e) => self.state.status_message = status_err("kubevirt-start", &e),
                }
            }
            ["q"] | ["quit"] => self.should_quit = true,
            _ if parts.first() == Some(&"browse") => {
                let path = if parts.len() <= 1 {
                    String::new()
                } else {
                    parts[1..].join(" ")
                };
                self.run_browse_command(&path).await;
            }
            _ => self.state.status_message = format!("Unknown command: {cmd}"),
        }
    }

    fn navigate_to_category(&mut self, cat: SidebarCategory) {
        self.state.command_content_override = None;
        self.select_sidebar_category(cat);
    }

    fn select_sidebar_category(&mut self, cat: SidebarCategory) {
        if let Some(pos) = self
            .state
            .sidebar_items
            .iter()
            .position(|item| *item == SidebarItem::Category(cat))
        {
            self.state.sidebar_selected = pos;
        }
        self.state.resource_view = self.state.sidebar_resource_view();
        self.state.selected_index = 0;
        self.state.content_scroll_offset = 0;
    }

    // ── Refresh ─────────────────────────────────────────────────────────

    fn apply_vm_data(&mut self, vms: Vec<machina_core::VmInfo>) {
        self.state.connected = true;
        self.state.vms = vms;
        self.state.sort_vms();
        self.state.detect_state_changes();
        self.state.clamp_selection();
    }

    async fn refresh_all_data(&mut self) {
        // Fetch all independent resources in parallel
        let (vms, nets, pools, snaps, node, metrics) = tokio::join!(
            self.client.fetch_vms(),
            self.client.fetch_networks(),
            self.client.fetch_storage_pools(),
            self.client.fetch_all_snapshots(),
            self.client.fetch_node_info(),
            self.client.fetch_metrics(),
        );

        match vms {
            Ok(vms) => self.apply_vm_data(vms),
            Err(e) => {
                self.state.connected = false;
                self.state.status_message = status_err("Error", &e);
            }
        }
        if let Ok(nets) = nets {
            self.state.networks = nets;
        }
        if let Ok(pools) = pools {
            self.state.storage_pools = pools;
        }
        if let Ok(snaps) = snaps {
            self.state.snapshots = snaps;
        }
        if let Ok(info) = node {
            self.state.node_info = Some(info);
        }
        if let Ok(backups) = self.client.fetch_backups().await {
            self.state.backups = backups;
        }
        if let Ok(m) = metrics {
            self.state.vm_metrics = m;
            self.state.record_metrics_snapshot();
        }

        if let Some(pool) = self.state.browsing_pool.clone() {
            if let Ok(vols) = self.client.fetch_volumes(&pool).await {
                self.state.volumes = vols;
            }
        }

        self.refresh_openstack().await;

        self.state.compute_dashboard();
        self.state.rebuild_sidebar();
        self.state.clamp_selection();
    }

    async fn refresh_vms_and_metrics(&mut self) {
        match self.client.fetch_vms().await {
            Ok(vms) => self.apply_vm_data(vms),
            Err(e) => {
                self.state.connected = false;
                self.state.status_message = status_err("Error", &e);
            }
        }

        if let Ok(metrics) = self.client.fetch_metrics().await {
            self.state.vm_metrics = metrics;
            self.state.record_metrics_snapshot();
        }

        self.state.compute_dashboard();
        self.state.rebuild_sidebar();
    }
}

fn wizard_step_hint(step: OpenStackCreateStep) -> String {
    match step {
        OpenStackCreateStep::Name => "Enter instance name".to_string(),
        OpenStackCreateStep::Flavor => "Pick flavor (j/k Enter, Backspace back)".to_string(),
        OpenStackCreateStep::Image => {
            "Pick Glance image (j/k Enter, n skip, Backspace back)".to_string()
        }
        OpenStackCreateStep::Network => {
            "Pick Neutron network (j/k Enter, Backspace back)".to_string()
        }
        OpenStackCreateStep::Keypair => {
            "Pick SSH keypair (j/k Enter, n skip, Backspace back)".to_string()
        }
        OpenStackCreateStep::Confirm => "Confirm — Enter create, Backspace edit".to_string(),
    }
}
