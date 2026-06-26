// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

use std::collections::VecDeque;

use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Cell, Clear, Paragraph, Row, Table, Wrap};
use ratatui::Frame;

use machina_core::{
    AppState, Focus, InputMode, NotifyLevel, ObjectTab, OpenStackCreateStep, ResourceView,
    SidebarCategory, SidebarItem, ViewMode,
};

// ── GuestKit Theme Colors ───────────────────────────────────────────────

const ORANGE: Color = Color::Rgb(222, 115, 86);
const DARK_ORANGE: Color = Color::Rgb(180, 85, 60);
const LIGHT_ORANGE: Color = Color::Rgb(255, 145, 115);
const TEXT_COLOR: Color = Color::Rgb(220, 220, 220);
const SUCCESS_COLOR: Color = Color::Rgb(50, 205, 50);
const WARNING_COLOR: Color = Color::Rgb(255, 200, 0);
const ERROR_COLOR: Color = Color::Rgb(220, 50, 47);
const INFO_COLOR: Color = Color::Rgb(100, 150, 255);
const HIGHLIGHT_BG: Color = Color::Rgb(60, 40, 20);
const DIM_BORDER: Color = Color::Rgb(100, 60, 40);

const SPARKLINE_BLOCKS: [char; 8] = [
    '\u{2581}', '\u{2582}', '\u{2583}', '\u{2584}', '\u{2585}', '\u{2586}', '\u{2587}', '\u{2588}',
];

// Pre-built common styles to avoid repeated Style::new().fg(...) constructions
const ORANGE_BOLD: Style = Style::new().fg(ORANGE).add_modifier(Modifier::BOLD);
const TEXT_STYLE: Style = Style::new().fg(TEXT_COLOR);
const DIM_STYLE: Style = Style::new().fg(Color::DarkGray);
const LABEL_STYLE: Style = Style::new().fg(ORANGE);
const NAME_STYLE: Style = Style::new().fg(LIGHT_ORANGE);
const NAME_BOLD: Style = Style::new().fg(LIGHT_ORANGE).add_modifier(Modifier::BOLD);
const DARK_ORANGE_STYLE: Style = Style::new().fg(DARK_ORANGE);
const SUCCESS_STYLE: Style = Style::new().fg(SUCCESS_COLOR);
const INFO_STYLE: Style = Style::new().fg(INFO_COLOR);

// ── Main render ─────────────────────────────────────────────────────────

pub fn render(frame: &mut Frame, state: &AppState) {
    let chunks = Layout::vertical([
        Constraint::Length(1), // Header bar
        Constraint::Min(0),    // Sidebar + Content
        Constraint::Length(1), // Recent tasks bar
        Constraint::Length(1), // Key hints / search / command
    ])
    .split(frame.area());

    render_header_bar(frame, chunks[0], state);

    // Sidebar + Content horizontal split
    let sidebar_width = compute_sidebar_width(chunks[1].width);
    let main_chunks = Layout::horizontal([Constraint::Length(sidebar_width), Constraint::Min(0)])
        .split(chunks[1]);

    render_sidebar(frame, main_chunks[0], state);

    // Content area: check for overlay modes first
    match state.view_mode {
        ViewMode::Xml => render_xml_view(frame, main_chunks[1], state),
        ViewMode::Logs => render_log_view(frame, main_chunks[1], state),
        ViewMode::Help => {
            render_content_panel(frame, main_chunks[1], state);
            render_help_overlay(frame, frame.area(), state);
        }
        ViewMode::OpenStackCreate => {
            render_content_panel(frame, main_chunks[1], state);
            render_openstack_create_wizard(frame, main_chunks[1], state);
        }
        _ => render_content_panel(frame, main_chunks[1], state),
    }

    // Overlays
    if state.show_context_menu {
        render_context_menu(frame, frame.area(), state);
    }

    if state.confirm_dialog.is_some() && state.input_mode == InputMode::Confirmation {
        render_confirmation_dialog(frame, frame.area(), state);
    }

    if let Some((ref msg, ref when, ref level)) = state.notification {
        if when.elapsed().as_secs() < 3 {
            render_notification(frame, frame.area(), msg, *level);
        }
    }

    render_recent_tasks_bar(frame, chunks[2], state);
    render_bottom_bar(frame, chunks[3], state);
}

fn compute_sidebar_width(available: u16) -> u16 {
    let w = available / 5; // 20%
    w.clamp(22, 30)
}

// ── Header bar ──────────────────────────────────────────────────────────

fn render_header_bar(frame: &mut Frame, area: Rect, state: &AppState) {
    let mut spans: Vec<Span> = vec![
        Span::styled(" \u{26A1} ", ORANGE_BOLD),
        Span::styled("Machina", NAME_BOLD),
    ];

    // Hostname from node_info
    if let Some(ref node) = state.node_info {
        spans.push(Span::styled("  Host: ", DARK_ORANGE_STYLE));
        spans.push(Span::styled(&node.hostname, TEXT_STYLE));
    }

    // Resource summary on wider terminals
    if area.width >= 80 {
        let d = &state.dashboard;
        if d.total_vms > 0 {
            spans.push(Span::styled("  VMs:", DARK_ORANGE_STYLE));
            spans.push(Span::styled(
                format!("{}\u{25cf}", d.running_vms),
                SUCCESS_STYLE,
            ));
            spans.push(Span::styled(format!("/{} ", d.total_vms), TEXT_STYLE));
        }
        if d.total_networks > 0 && area.width >= 100 {
            spans.push(Span::styled("Net:", DARK_ORANGE_STYLE));
            spans.push(Span::styled(
                format!("{}/{} ", d.active_networks, d.total_networks),
                TEXT_STYLE,
            ));
        }
        if d.total_pools > 0 && area.width >= 120 {
            spans.push(Span::styled("Stor:", DARK_ORANGE_STYLE));
            spans.push(Span::styled(
                format!("{}/{} ", d.active_pools, d.total_pools),
                TEXT_STYLE,
            ));
        }
    }

    // Connection indicator
    let (conn_text, conn_color) = if state.connected {
        (" \u{25cf}", SUCCESS_COLOR)
    } else {
        (" \u{25cb}", ERROR_COLOR)
    };
    spans.push(Span::styled(conn_text, Style::new().fg(conn_color)));

    // Multi-select badge
    if state.multi_select_mode {
        spans.push(Span::styled(
            format!(" [{}sel]", state.selected_items.len()),
            Style::new().fg(WARNING_COLOR).add_modifier(Modifier::BOLD),
        ));
    }

    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

// ── Sidebar ─────────────────────────────────────────────────────────────

fn render_sidebar(frame: &mut Frame, area: Rect, state: &AppState) {
    let block = panel_block(state.focus == Focus::Sidebar, " INVENTORY ");

    let inner = block.inner(area);
    frame.render_widget(block, area);

    if state.sidebar_items.is_empty() {
        let empty = Paragraph::new(Line::from(Span::styled(" Loading...", DIM_STYLE)));
        frame.render_widget(empty, inner);
        return;
    }

    let visible_height = inner.height as usize;
    let max_name_width = inner.width.saturating_sub(5) as usize; // leave room for indicators

    // Compute scroll offset for sidebar
    let scroll_start = if state.sidebar_selected >= visible_height {
        state.sidebar_selected - visible_height + 1
    } else {
        0
    };

    let total_items = state.sidebar_items.len();
    let mut lines: Vec<Line> = Vec::new();

    for (i, item) in state
        .sidebar_items
        .iter()
        .enumerate()
        .skip(scroll_start)
        .take(visible_height)
    {
        let is_selected = i == state.sidebar_selected;
        let line = match item {
            SidebarItem::Category(cat) => {
                let collapsed = *state.sidebar_collapsed.get(cat).unwrap_or(&false);
                let arrow = if collapsed { "\u{25b6}" } else { "\u{25bc}" }; // > or v
                let count_label = match cat {
                    SidebarCategory::VirtualMachines => {
                        let running = state.vms.iter().filter(|v| v.state == "running").count();
                        let total = state.vms.len();
                        format!("{running}/{total}")
                    }
                    SidebarCategory::Networks => {
                        let active = state.networks.iter().filter(|n| n.active).count();
                        let total = state.networks.len();
                        format!("{active}/{total}")
                    }
                    SidebarCategory::Storage => {
                        let active = state
                            .storage_pools
                            .iter()
                            .filter(|p| p.state == "running")
                            .count();
                        let total = state.storage_pools.len();
                        format!("{active}/{total}")
                    }
                    SidebarCategory::Snapshots => {
                        format!("{}", state.snapshots.len())
                    }
                    SidebarCategory::Backups => {
                        format!("{}", state.backups.len())
                    }
                    SidebarCategory::OpenStack => {
                        format!("{}", state.openstack_instances.len())
                    }
                };
                let label = format!("{arrow} {} ({count_label})", cat.label());
                let style = if is_selected {
                    ORANGE_BOLD.bg(HIGHLIGHT_BG)
                } else {
                    ORANGE_BOLD
                };
                Line::from(Span::styled(label, style))
            }
            SidebarItem::Vm(name) => {
                let vm_state = state.vm_state_str(name);
                let indicator = state_indicator(vm_state);
                Line::from(vec![
                    Span::styled(
                        format!("  {indicator} "),
                        Style::new().fg(state_color(vm_state)),
                    ),
                    Span::styled(
                        truncate_str(name, max_name_width),
                        sidebar_item_style(is_selected),
                    ),
                ])
            }
            SidebarItem::Network(name) => {
                let active = state.find_network(name).map(|n| n.active).unwrap_or(false);
                let (indicator, color) = if active {
                    ("\u{25cf}", SUCCESS_COLOR)
                } else {
                    ("\u{25cb}", ERROR_COLOR)
                };
                Line::from(vec![
                    Span::styled(format!("  {indicator} "), Style::new().fg(color)),
                    Span::styled(
                        truncate_str(name, max_name_width),
                        sidebar_item_style(is_selected),
                    ),
                ])
            }
            SidebarItem::StoragePool(name) => Line::from(vec![
                Span::raw("    "),
                Span::styled(
                    truncate_str(name, max_name_width.saturating_sub(2)),
                    sidebar_item_style(is_selected),
                ),
            ]),
            SidebarItem::Snapshot(vm, snap) => {
                let label = format!("{vm}/{snap}");
                Line::from(vec![
                    Span::raw("    "),
                    Span::styled(
                        truncate_str(&label, max_name_width.saturating_sub(2)),
                        sidebar_item_style(is_selected),
                    ),
                ])
            }
            SidebarItem::OpenStackCreate => Line::from(vec![
                Span::styled("  + ", Style::new().fg(SUCCESS_COLOR)),
                Span::styled(
                    truncate_str("Create instance", max_name_width),
                    sidebar_item_style(is_selected),
                ),
            ]),
            SidebarItem::OpenStackImages => Line::from(vec![
                Span::styled("  ◆ ", Style::new().fg(INFO_COLOR)),
                Span::styled(
                    truncate_str("Glance images", max_name_width),
                    sidebar_item_style(is_selected),
                ),
            ]),
            SidebarItem::OpenStackInstance(id) => {
                let label = state
                    .find_openstack_instance(id)
                    .map(|i| i.name.as_str())
                    .unwrap_or(id.as_str());
                let status = state
                    .find_openstack_instance(id)
                    .map(|i| i.status.as_str())
                    .unwrap_or("?");
                let color = match status.to_uppercase().as_str() {
                    "ACTIVE" => SUCCESS_COLOR,
                    "SHUTOFF" | "STOPPED" => DIM_BORDER,
                    "ERROR" => ERROR_COLOR,
                    _ => WARNING_COLOR,
                };
                Line::from(vec![
                    Span::styled("  ● ", Style::new().fg(color)),
                    Span::styled(
                        truncate_str(label, max_name_width),
                        sidebar_item_style(is_selected),
                    ),
                ])
            }
        };
        lines.push(line);
    }

    let paragraph = Paragraph::new(lines);
    frame.render_widget(paragraph, inner);

    // Scroll position indicator in bottom-right of sidebar border
    if total_items > visible_height {
        let pos = format!("{}/{}", state.sidebar_selected + 1, total_items,);
        let pos_x = area.x + area.width.saturating_sub(pos.len() as u16 + 2);
        let pos_y = area.y + area.height - 1;
        if pos_x > area.x && pos_y > area.y {
            let pos_area = Rect {
                x: pos_x,
                y: pos_y,
                width: pos.len() as u16 + 2,
                height: 1,
            };
            frame.render_widget(
                Paragraph::new(Span::styled(format!(" {pos} "), DARK_ORANGE_STYLE)),
                pos_area,
            );
        }
    }
}

// ── Content panel dispatch ──────────────────────────────────────────────

fn render_content_panel(frame: &mut Frame, area: Rect, state: &AppState) {
    // Check for command-driven overrides (:events, :node)
    if let Some(override_view) = state.command_content_override {
        match override_view {
            ResourceView::Events => {
                render_events_table(frame, area, state);
                return;
            }
            ResourceView::Node => {
                render_node_view(frame, area, state);
                return;
            }
            _ => {}
        }
    }

    match state.selected_sidebar_item() {
        Some(SidebarItem::Category(SidebarCategory::VirtualMachines)) => {
            render_vm_table(frame, area, state);
        }
        Some(SidebarItem::Category(SidebarCategory::Networks)) => {
            render_network_table(frame, area, state);
        }
        Some(SidebarItem::Category(SidebarCategory::Storage)) => {
            if state.browsing_pool.is_some() {
                let chunks =
                    Layout::vertical([Constraint::Length(1), Constraint::Min(0)]).split(area);
                render_breadcrumb(frame, chunks[0], state);
                render_volume_table(frame, chunks[1], state);
            } else {
                render_storage_table(frame, area, state);
            }
        }
        Some(SidebarItem::Category(SidebarCategory::Snapshots)) => {
            render_snapshot_table(frame, area, state);
        }
        Some(SidebarItem::Category(SidebarCategory::Backups)) => {
            render_backup_table(frame, area, state);
        }
        Some(SidebarItem::Category(SidebarCategory::OpenStack)) => {
            render_openstack_overview(frame, area, state);
        }
        Some(SidebarItem::OpenStackImages) => {
            render_openstack_images_table(frame, area, state);
        }
        Some(SidebarItem::OpenStackCreate) => {
            render_openstack_create_prompt(frame, area, state);
        }
        Some(SidebarItem::OpenStackInstance(id)) => {
            let id = id.clone();
            render_openstack_instance_detail(frame, area, state, &id);
        }
        Some(SidebarItem::Vm(name)) => {
            let name = name.clone();
            render_vm_content(frame, area, state, &name);
        }
        Some(SidebarItem::Network(name)) => {
            let name = name.clone();
            render_network_detail(frame, area, state, &name);
        }
        Some(SidebarItem::StoragePool(name)) => {
            let name = name.clone();
            render_pool_detail(frame, area, state, &name);
        }
        Some(SidebarItem::Snapshot(vm, snap)) => {
            let vm = vm.clone();
            let snap = snap.clone();
            render_snapshot_detail(frame, area, state, &vm, &snap);
        }
        None => {
            let p = Paragraph::new(Line::from(Span::styled(" No item selected", DIM_STYLE)))
                .block(content_block(state, ""));
            frame.render_widget(p, area);
        }
    }
}

fn panel_block(focused: bool, title: &str) -> Block<'static> {
    let (border, title_fg) = if focused {
        (ORANGE, ORANGE)
    } else {
        (DIM_BORDER, DARK_ORANGE)
    };
    Block::new()
        .borders(Borders::ALL)
        .border_style(Style::new().fg(border))
        .title(title.to_string())
        .title_style(Style::new().fg(title_fg).add_modifier(Modifier::BOLD))
}

fn content_block(state: &AppState, title: &str) -> Block<'static> {
    panel_block(state.focus == Focus::Content, title)
}

// ── VM Content with sub-tabs ────────────────────────────────────────────

fn render_vm_content(frame: &mut Frame, area: Rect, state: &AppState, vm_name: &str) {
    let chunks = Layout::vertical([
        Constraint::Length(1), // Sub-tab bar
        Constraint::Min(0),    // Tab content
    ])
    .split(area);

    render_object_tab_bar(frame, chunks[0], state, vm_name);

    let content_area = chunks[1];
    match state.active_object_tab {
        ObjectTab::Summary => render_vm_summary(frame, content_area, state, vm_name),
        ObjectTab::Monitor => render_vm_monitor(frame, content_area, state, vm_name),
        ObjectTab::Configure => render_vm_configure(frame, content_area, state, vm_name),
    }
}

fn render_object_tab_bar(frame: &mut Frame, area: Rect, state: &AppState, vm_name: &str) {
    // Truncate VM name to leave room for tabs (~30 chars for tab labels)
    let max_name = (area.width as usize).saturating_sub(35);
    let display_name = truncate_str(vm_name, max_name.max(8));

    // VM state indicator
    let vm_state = state
        .vms
        .iter()
        .find(|v| v.name == vm_name)
        .map(|v| v.state.as_str())
        .unwrap_or("unknown");
    let state_dot = state_indicator(vm_state);

    let mut spans: Vec<Span> = vec![
        Span::styled(
            format!(" {state_dot}"),
            Style::new().fg(state_color(vm_state)),
        ),
        Span::styled(format!(" {display_name} "), NAME_BOLD),
        Span::styled("\u{2502} ", DARK_ORANGE_STYLE),
    ];

    for tab in ObjectTab::all() {
        let is_active = *tab == state.active_object_tab;
        let label = format!(" {} ", tab.label());
        if is_active {
            spans.push(Span::styled(
                label,
                Style::new()
                    .fg(Color::Black)
                    .bg(ORANGE)
                    .add_modifier(Modifier::BOLD),
            ));
        } else {
            spans.push(Span::styled(label, TEXT_STYLE));
        }
    }

    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

fn render_vm_summary(frame: &mut Frame, area: Rect, state: &AppState, vm_name: &str) {
    let mut lines: Vec<Line> = Vec::new();

    if let Some(d) = vm_details_for(state, vm_name) {
        lines.push(kv_line("Name:        ", &d.name));
        lines.push(kv_line("UUID:        ", &d.uuid));
        lines.push(Line::from(vec![
            Span::styled("State:       ", LABEL_STYLE),
            Span::styled(
                &d.state,
                Style::new()
                    .fg(state_color(&d.state))
                    .add_modifier(Modifier::BOLD),
            ),
        ]));
        lines.push(kv_line("vCPUs:       ", &d.vcpus.to_string()));
        lines.push(kv_line("Memory:      ", &format!("{} MB", d.memory_mb)));
        lines.push(kv_line("OS Type:     ", &d.os_type));
        lines.push(kv_line("Arch:        ", &d.arch));
        lines.push(kv_line("Persistent:  ", bool_label(d.persistent)));
        lines.push(kv_line("Autostart:   ", bool_label(d.autostart)));

        if !d.interfaces.is_empty() {
            lines.push(Line::from(""));
            lines.push(section_header("Interfaces"));
            for iface in &d.interfaces {
                lines.push(Line::from(Span::styled(
                    format!(
                        "  MAC: {}  Source: {}  Model: {}",
                        iface.mac_address, iface.source, iface.model
                    ),
                    TEXT_STYLE,
                )));
            }
        }

        if !d.disks.is_empty() {
            lines.push(Line::from(""));
            lines.push(section_header("Disks"));
            for disk in &d.disks {
                lines.push(Line::from(Span::styled(
                    format!(
                        "  {} ({})  Target: {}  Driver: {}",
                        disk.source, disk.device, disk.target, disk.driver
                    ),
                    TEXT_STYLE,
                )));
            }
        }
    } else {
        lines.push(vm_basic_info_from_list(state, vm_name));
        lines.extend(load_hint_lines("full details"));
    }

    // Metrics summary if available
    if let Some(m) = state.get_metrics_for_vm(vm_name) {
        lines.push(Line::from(""));
        lines.push(section_header("Metrics"));
        lines.push(Line::from(Span::styled(
            format!(
                "  Memory: {} / {} MB ({:.0}%) {}",
                m.memory_used_mb,
                m.memory_total_mb,
                m.memory_pct,
                memory_bar(m.memory_pct)
            ),
            TEXT_STYLE,
        )));
        lines.push(Line::from(Span::styled(
            format!("  CPU time: {:.2}s", m.cpu_time_ns as f64 / 1_000_000_000.0),
            TEXT_STYLE,
        )));
    }

    let paragraph = Paragraph::new(lines)
        .style(TEXT_STYLE)
        .block(content_block(state, " Summary "))
        .scroll((state.content_scroll_offset, 0))
        .wrap(Wrap { trim: true });
    frame.render_widget(paragraph, area);
}

fn vm_basic_info_from_list<'a>(state: &AppState, vm_name: &str) -> Line<'a> {
    if let Some(vm) = state.find_vm(vm_name) {
        Line::from(vec![
            Span::styled(format!("  {} ", vm.name), NAME_BOLD),
            Span::styled(
                format!("[{}] ", vm.state),
                Style::new().fg(state_color(&vm.state)),
            ),
            Span::styled(
                format!("vCPUs:{} Mem:{}MB", vm.vcpus, vm.memory_mb),
                TEXT_STYLE,
            ),
        ])
    } else {
        Line::from(Span::styled(format!("  {vm_name}"), TEXT_STYLE))
    }
}

fn render_vm_monitor(frame: &mut Frame, area: Rect, state: &AppState, vm_name: &str) {
    let mut lines: Vec<Line> = Vec::new();

    if let Some(m) = state.get_metrics_for_vm(vm_name) {
        lines.push(Line::from(Span::styled(
            format!(
                "CPU time: {:.2}s  vCPUs: {}",
                m.cpu_time_ns as f64 / 1_000_000_000.0,
                m.vcpus
            ),
            TEXT_STYLE,
        )));
        lines.push(Line::from(""));

        // Memory bar
        lines.push(Line::from(vec![
            Span::styled("Memory:  ", ORANGE_BOLD),
            Span::styled(
                format!(
                    "{:.0}% {} ({}/{} MB)",
                    m.memory_pct,
                    memory_bar(m.memory_pct),
                    m.memory_used_mb,
                    m.memory_total_mb
                ),
                Style::new().fg(pct_color(m.memory_pct)),
            ),
        ]));

        // Sparkline trend
        if let Some(history) = state.metrics_history.get(vm_name) {
            if !history.is_empty() {
                lines.push(Line::from(vec![
                    Span::styled("Trend:   ", ORANGE_BOLD),
                    Span::styled(mini_sparkline(history), INFO_STYLE),
                ]));
            }
        }

        lines.push(Line::from(""));

        // Disk I/O
        if m.disk_rd_bytes > 0 || m.disk_wr_bytes > 0 {
            lines.push(Line::from(vec![
                Span::styled("Disk I/O: ", ORANGE_BOLD),
                Span::styled(
                    format!(
                        "read {} / written {}",
                        format_bytes(m.disk_rd_bytes),
                        format_bytes(m.disk_wr_bytes)
                    ),
                    TEXT_STYLE,
                ),
            ]));
        }

        // Network I/O
        if m.net_rx_bytes > 0 || m.net_tx_bytes > 0 {
            lines.push(Line::from(vec![
                Span::styled("Network:  ", ORANGE_BOLD),
                Span::styled(
                    format!(
                        "RX {} / TX {}",
                        format_bytes(m.net_rx_bytes),
                        format_bytes(m.net_tx_bytes)
                    ),
                    TEXT_STYLE,
                ),
            ]));
        }
    } else {
        let vm_state = state
            .vms
            .iter()
            .find(|v| v.name == vm_name)
            .map(|v| v.state.as_str())
            .unwrap_or("unknown");
        if vm_state == "running" {
            lines.push(Line::from(Span::styled(
                "Collecting metrics...",
                DARK_ORANGE_STYLE,
            )));
            lines.push(Line::from(Span::styled(
                "Data will appear on next refresh cycle",
                DIM_STYLE,
            )));
        } else {
            lines.push(Line::from(Span::styled(
                format!("VM is {vm_state} - metrics available when running"),
                DIM_STYLE,
            )));
        }
    }

    let paragraph = Paragraph::new(lines)
        .style(TEXT_STYLE)
        .block(content_block(state, " Monitor "))
        .scroll((state.content_scroll_offset, 0));
    frame.render_widget(paragraph, area);
}

fn render_vm_configure(frame: &mut Frame, area: Rect, state: &AppState, vm_name: &str) {
    let mut lines: Vec<Line> = Vec::new();

    if let Some(d) = vm_details_for(state, vm_name) {
        lines.push(section_header("Hardware"));
        lines.push(kv_line("  vCPUs:      ", &d.vcpus.to_string()));
        lines.push(kv_line(
            "  Memory:     ",
            &format!("{} MB ({:.1} GB)", d.memory_mb, d.memory_mb as f64 / 1024.0),
        ));
        lines.push(kv_line("  OS Type:    ", &d.os_type));
        lines.push(kv_line("  Arch:       ", &d.arch));

        lines.push(Line::from(""));
        lines.push(section_header("Management"));
        lines.push(Line::from(vec![
            Span::styled("  Autostart:  ", LABEL_STYLE),
            Span::styled(
                if d.autostart { "enabled" } else { "disabled" },
                Style::new().fg(if d.autostart {
                    SUCCESS_COLOR
                } else {
                    Color::DarkGray
                }),
            ),
        ]));
        lines.push(kv_line("  Persistent: ", bool_label(d.persistent)));

        if !d.disks.is_empty() {
            lines.push(Line::from(""));
            lines.push(section_header("Disks"));
            for disk in &d.disks {
                lines.push(Line::from(vec![
                    Span::styled(format!("  {}: ", disk.target), NAME_STYLE),
                    Span::styled(&disk.source, TEXT_STYLE),
                    Span::styled(format!(" ({})", disk.driver), DIM_STYLE),
                ]));
            }
        }

        if !d.interfaces.is_empty() {
            lines.push(Line::from(""));
            lines.push(section_header("Network Interfaces"));
            for iface in &d.interfaces {
                lines.push(Line::from(vec![
                    Span::styled(format!("  {} ", iface.mac_address), NAME_STYLE),
                    Span::styled(&iface.source, TEXT_STYLE),
                    Span::styled(format!(" ({})", iface.model), DIM_STYLE),
                ]));
            }
        }

        lines.push(Line::from(""));
        lines.push(section_header("Actions"));
        lines.push(Line::from(vec![
            Span::styled("  :resize ", LABEL_STYLE),
            Span::styled(format!("{vm_name} vcpus <n>"), TEXT_STYLE),
            Span::styled("  Change vCPU count", DIM_STYLE),
        ]));
        lines.push(Line::from(vec![
            Span::styled("  :resize ", LABEL_STYLE),
            Span::styled(format!("{vm_name} memory <mb>"), TEXT_STYLE),
            Span::styled("  Change memory", DIM_STYLE),
        ]));
        lines.push(Line::from(vec![
            Span::styled("  t", ORANGE_BOLD),
            Span::styled("  Toggle autostart", TEXT_STYLE),
        ]));
        lines.push(Line::from(vec![
            Span::styled("  y", ORANGE_BOLD),
            Span::styled("  View full XML definition", TEXT_STYLE),
        ]));
    } else {
        lines.push(vm_basic_info_from_list(state, vm_name));
        lines.extend(load_hint_lines("configuration"));
    }

    let paragraph = Paragraph::new(lines)
        .style(TEXT_STYLE)
        .block(content_block(state, " Configure "))
        .scroll((state.content_scroll_offset, 0));
    frame.render_widget(paragraph, area);
}

// ── Network detail ──────────────────────────────────────────────────────

fn render_network_detail(frame: &mut Frame, area: Rect, state: &AppState, net_name: &str) {
    let mut lines: Vec<Line> = Vec::new();

    if let Some(net) = state.find_network(net_name) {
        lines.push(kv_line("Name:       ", &net.name));
        lines.push(kv_line("UUID:       ", &net.uuid));
        lines.push(Line::from(vec![
            Span::styled("Active:     ", LABEL_STYLE),
            Span::styled(
                bool_label(net.active),
                Style::new().fg(if net.active {
                    SUCCESS_COLOR
                } else {
                    ERROR_COLOR
                }),
            ),
        ]));
        lines.push(kv_line("Bridge:     ", &net.bridge));
        lines.push(kv_line("Autostart:  ", bool_label(net.autostart)));
        lines.push(kv_line("Persistent: ", bool_label(net.persistent)));
        lines.push(Line::from(""));
        lines.push(section_header("Actions"));
        if net.active {
            lines.push(Line::from(vec![
                Span::styled("  z", ORANGE_BOLD),
                Span::styled("  Stop network", TEXT_STYLE),
            ]));
        } else {
            lines.push(Line::from(vec![
                Span::styled("  a", ORANGE_BOLD),
                Span::styled("  Start network", TEXT_STYLE),
            ]));
        }
    } else {
        lines.push(Line::from(Span::styled(
            format!("Network '{net_name}' not found"),
            DIM_STYLE,
        )));
    }

    let paragraph = Paragraph::new(lines)
        .style(TEXT_STYLE)
        .block(content_block(state, &format!(" Network: {net_name} ")))
        .scroll((state.content_scroll_offset, 0));
    frame.render_widget(paragraph, area);
}

// ── Storage pool detail ─────────────────────────────────────────────────

fn render_pool_detail(frame: &mut Frame, area: Rect, state: &AppState, pool_name: &str) {
    if state.browsing_pool.is_some() {
        // Show volume table when browsing
        let chunks = Layout::vertical([Constraint::Length(1), Constraint::Min(0)]).split(area);
        render_breadcrumb(frame, chunks[0], state);
        render_volume_table(frame, chunks[1], state);
        return;
    }

    let chunks = Layout::vertical([
        Constraint::Length(10), // Pool info
        Constraint::Min(0),     // Actions
    ])
    .split(area);

    let mut lines: Vec<Line> = Vec::new();

    if let Some(pool) = state.find_pool(pool_name) {
        lines.push(kv_line("Name:       ", &pool.name));
        lines.push(kv_line("UUID:       ", &pool.uuid));
        lines.push(Line::from(vec![
            Span::styled("State:      ", LABEL_STYLE),
            Span::styled(&pool.state, Style::new().fg(state_color(&pool.state))),
        ]));
        lines.push(kv_line(
            "Capacity:   ",
            &format!("{:.1} GB", pool.capacity_gb),
        ));
        lines.push(kv_line(
            "Used:       ",
            &format!("{:.1} GB", pool.allocation_gb),
        ));
        lines.push(kv_line(
            "Available:  ",
            &format!("{:.1} GB", pool.available_gb),
        ));
        if pool.capacity_gb > 0.0 {
            let usage_pct = (pool.allocation_gb / pool.capacity_gb * 100.0).min(100.0);
            lines.push(Line::from(vec![
                Span::styled("Usage:      ", LABEL_STYLE),
                Span::styled(
                    format!("{:.0}% {}", usage_pct, memory_bar(usage_pct)),
                    Style::new().fg(pct_color(usage_pct)),
                ),
            ]));
        }
        lines.push(kv_line("Autostart:  ", bool_label(pool.autostart)));
    }

    let paragraph = Paragraph::new(lines)
        .style(TEXT_STYLE)
        .block(content_block(state, &format!(" Storage: {pool_name} ")));
    frame.render_widget(paragraph, chunks[0]);

    let mut vol_lines = vec![Line::from(vec![
        Span::styled("  Enter", ORANGE_BOLD),
        Span::styled("  Browse volumes", TEXT_STYLE),
    ])];
    if let Some(pool) = state.find_pool(pool_name) {
        if pool.state == "running" {
            vol_lines.push(Line::from(vec![
                Span::styled("  z", ORANGE_BOLD),
                Span::styled("  Stop pool", TEXT_STYLE),
            ]));
        } else {
            vol_lines.push(Line::from(vec![
                Span::styled("  a", ORANGE_BOLD),
                Span::styled("  Start pool", TEXT_STYLE),
            ]));
        }
    }
    let hint = Paragraph::new(vol_lines).block(content_block(state, " Actions "));
    frame.render_widget(hint, chunks[1]);
}

// ── Snapshot detail ─────────────────────────────────────────────────────

fn render_snapshot_detail(
    frame: &mut Frame,
    area: Rect,
    state: &AppState,
    vm_name: &str,
    snap_name: &str,
) {
    let mut lines: Vec<Line> = Vec::new();

    if let Some(snap) = state.find_snapshot(vm_name, snap_name) {
        lines.push(kv_line("VM:          ", &snap.vm_name));
        lines.push(kv_line("Snapshot:    ", &snap.name));
        lines.push(kv_line("State:       ", &snap.state));
        lines.push(Line::from(vec![
            Span::styled("Current:     ", LABEL_STYLE),
            Span::styled(
                if snap.is_current {
                    "\u{25cf} yes"
                } else {
                    "no"
                },
                Style::new().fg(if snap.is_current {
                    SUCCESS_COLOR
                } else {
                    TEXT_COLOR
                }),
            ),
        ]));
        if !snap.parent.is_empty() {
            lines.push(kv_line("Parent:      ", &snap.parent));
        }
        if !snap.description.is_empty() {
            lines.push(kv_line("Description: ", &snap.description));
        }
        lines.push(Line::from(""));
        lines.push(section_header("Actions"));
        lines.push(Line::from(vec![
            Span::styled("  R", ORANGE_BOLD),
            Span::styled("  Revert VM to this snapshot", TEXT_STYLE),
        ]));
        lines.push(Line::from(vec![
            Span::styled("  d", ORANGE_BOLD),
            Span::styled("  Delete this snapshot", TEXT_STYLE),
        ]));
    } else {
        lines.push(Line::from(Span::styled(
            format!("Snapshot '{vm_name}/{snap_name}' not found"),
            DIM_STYLE,
        )));
    }

    let paragraph = Paragraph::new(lines)
        .style(TEXT_STYLE)
        .block(content_block(
            state,
            &format!(" Snapshot: {vm_name}/{snap_name} "),
        ))
        .scroll((state.content_scroll_offset, 0));
    frame.render_widget(paragraph, area);
}

// ── Tables (reused from original, adapted) ──────────────────────────────

fn render_vm_table(frame: &mut Frame, area: Rect, state: &AppState) {
    let has_metrics = !state.vm_metrics.is_empty();
    let w = area.width;
    let show_vcpus_mem = w >= 50;
    let show_metrics = has_metrics && w >= 70;
    let show_trend = has_metrics && w > 100 && !state.metrics_history.is_empty();

    let mut header_cells = vec![Cell::from(" "), Cell::from("Name"), Cell::from("State")];
    if show_vcpus_mem {
        header_cells.push(Cell::from("vCPUs"));
        header_cells.push(Cell::from("Mem (MB)"));
    }
    if show_metrics {
        header_cells.push(Cell::from("Mem %"));
    }
    if show_trend {
        header_cells.push(Cell::from("Trend"));
    }

    let header = Row::new(header_cells).style(ORANGE_BOLD).bottom_margin(1);

    let items: Vec<(usize, _)> = if state.search_active {
        state
            .filtered_indices
            .iter()
            .filter_map(|&i| state.vms.get(i).map(|vm| (i, vm)))
            .collect()
    } else {
        state.vms.iter().enumerate().collect()
    };

    let rows: Vec<Row> = items
        .iter()
        .enumerate()
        .map(|(display_idx, (_real_idx, vm))| {
            let sc = state_color(&vm.state);
            let sel_marker = if state.selected_items.contains(&vm.name) {
                "\u{2611}"
            } else {
                " "
            };

            let mut cells = vec![
                Cell::from(sel_marker).style(LABEL_STYLE),
                Cell::from(vm.name.as_str()).style(NAME_STYLE),
                Cell::from(vm.state.as_str()).style(Style::new().fg(sc)),
            ];

            if show_vcpus_mem {
                cells.push(Cell::from(vm.vcpus.to_string()).style(TEXT_STYLE));
                cells.push(Cell::from(vm.memory_mb.to_string()).style(TEXT_STYLE));
            }

            if show_metrics {
                if let Some(m) = state.get_metrics_for_vm(&vm.name) {
                    let bar = format!("{:.0}% {}", m.memory_pct, memory_bar(m.memory_pct));
                    cells.push(Cell::from(bar).style(Style::new().fg(pct_color(m.memory_pct))));
                } else {
                    cells.push(Cell::from("-").style(DIM_STYLE));
                }
            }

            if show_trend {
                if let Some(history) = state.metrics_history.get(&vm.name) {
                    cells.push(Cell::from(mini_sparkline(history)).style(INFO_STYLE));
                } else {
                    cells.push(Cell::from("-").style(DIM_STYLE));
                }
            }

            let row = Row::new(cells);
            if state.state_changed_vms.contains_key(&vm.name) {
                row.style(NAME_BOLD.bg(HIGHLIGHT_BG))
            } else if display_idx == state.selected_index {
                row.style(NAME_BOLD)
            } else {
                row
            }
        })
        .collect();

    let count = if state.search_active {
        state.filtered_indices.len()
    } else {
        state.vms.len()
    };
    let running = state.vms.iter().filter(|v| v.state == "running").count();

    let mut widths: Vec<Constraint> = vec![
        Constraint::Length(2),
        Constraint::Percentage(30),
        Constraint::Percentage(15),
    ];
    if show_vcpus_mem {
        widths.push(Constraint::Percentage(8));
        widths.push(Constraint::Percentage(12));
    }
    if show_metrics {
        widths.push(Constraint::Percentage(15));
    }
    if show_trend {
        widths.push(Constraint::Percentage(12));
    }

    let table = Table::new(rows, widths)
        .header(header)
        .column_spacing(1)
        .block(content_block(state, &format!(" VMs ({running}/{count}) ")));
    frame.render_widget(table, area);
}

fn render_network_table(frame: &mut Frame, area: Rect, state: &AppState) {
    let w = area.width;
    let show_extra = w >= 70;

    let mut hdr = vec![
        Cell::from("Name"),
        Cell::from("Active"),
        Cell::from("Autostart"),
    ];
    if show_extra {
        hdr.push(Cell::from("Bridge"));
        hdr.push(Cell::from("Persistent"));
    }
    let header = Row::new(hdr).style(ORANGE_BOLD).bottom_margin(1);

    let rows: Vec<Row> = state
        .networks
        .iter()
        .enumerate()
        .map(|(i, net)| {
            let active_color = if net.active {
                SUCCESS_COLOR
            } else {
                ERROR_COLOR
            };
            let mut cells = vec![
                Cell::from(net.name.as_str()).style(NAME_STYLE),
                Cell::from(bool_label(net.active)).style(Style::new().fg(active_color)),
                Cell::from(bool_label(net.autostart)).style(TEXT_STYLE),
            ];
            if show_extra {
                cells.push(Cell::from(net.bridge.as_str()).style(TEXT_STYLE));
                cells.push(Cell::from(bool_label(net.persistent)).style(TEXT_STYLE));
            }
            let row = Row::new(cells);
            select_row(row, i, state.selected_index)
        })
        .collect();

    let mut widths: Vec<Constraint> = vec![
        Constraint::Percentage(30),
        Constraint::Percentage(15),
        Constraint::Percentage(15),
    ];
    if show_extra {
        widths.push(Constraint::Percentage(25));
        widths.push(Constraint::Percentage(15));
    }

    let active = state.networks.iter().filter(|n| n.active).count();
    let table = Table::new(rows, widths)
        .header(header)
        .column_spacing(1)
        .block(content_block(
            state,
            &format!(" Networks ({}/{}) ", active, state.networks.len()),
        ));
    frame.render_widget(table, area);
}

fn render_storage_table(frame: &mut Frame, area: Rect, state: &AppState) {
    let w = area.width;
    let show_autostart = w >= 70;

    let mut hdr = vec![
        Cell::from("Name"),
        Cell::from("State"),
        Cell::from("Cap (GB)"),
        Cell::from("Used (GB)"),
        Cell::from("Avail (GB)"),
    ];
    if show_autostart {
        hdr.push(Cell::from("Autostart"));
    }
    let header = Row::new(hdr).style(ORANGE_BOLD).bottom_margin(1);

    let rows: Vec<Row> = state
        .storage_pools
        .iter()
        .enumerate()
        .map(|(i, pool)| {
            let sc = state_color(&pool.state);
            let mut cells = vec![
                Cell::from(pool.name.as_str()).style(NAME_STYLE),
                Cell::from(pool.state.as_str()).style(Style::new().fg(sc)),
                Cell::from(format!("{:.1}", pool.capacity_gb)).style(TEXT_STYLE),
                Cell::from(format!("{:.1}", pool.allocation_gb)).style(TEXT_STYLE),
                Cell::from(format!("{:.1}", pool.available_gb)).style(SUCCESS_STYLE),
            ];
            if show_autostart {
                cells.push(Cell::from(bool_label(pool.autostart)).style(TEXT_STYLE));
            }
            let row = Row::new(cells);
            select_row(row, i, state.selected_index)
        })
        .collect();

    let mut widths: Vec<Constraint> = vec![
        Constraint::Percentage(20),
        Constraint::Percentage(12),
        Constraint::Percentage(15),
        Constraint::Percentage(15),
        Constraint::Percentage(15),
    ];
    if show_autostart {
        widths.push(Constraint::Percentage(12));
    }

    let table = Table::new(rows, widths)
        .header(header)
        .column_spacing(1)
        .block(content_block(
            state,
            &format!(" Storage Pools ({}) ", state.storage_pools.len()),
        ));
    frame.render_widget(table, area);
}

fn render_snapshot_table(frame: &mut Frame, area: Rect, state: &AppState) {
    let header = Row::new(vec![
        Cell::from("VM"),
        Cell::from("Snapshot"),
        Cell::from("State"),
        Cell::from("Cur"),
        Cell::from("Parent"),
    ])
    .style(ORANGE_BOLD)
    .bottom_margin(1);

    let rows: Vec<Row> = state
        .snapshots
        .iter()
        .enumerate()
        .map(|(i, snap)| {
            let row = Row::new(vec![
                Cell::from(snap.vm_name.as_str()).style(NAME_STYLE),
                Cell::from(snap.name.as_str()).style(TEXT_STYLE),
                Cell::from(snap.state.as_str()).style(TEXT_STYLE),
                Cell::from(if snap.is_current { "\u{25cf}" } else { "" }).style(SUCCESS_STYLE),
                Cell::from(snap.parent.as_str()).style(DIM_STYLE),
            ]);
            select_row(row, i, state.selected_index)
        })
        .collect();

    let table = Table::new(
        rows,
        [
            Constraint::Percentage(25),
            Constraint::Percentage(25),
            Constraint::Percentage(20),
            Constraint::Percentage(10),
            Constraint::Percentage(20),
        ],
    )
    .header(header)
    .column_spacing(1)
    .block(content_block(
        state,
        &format!(" Snapshots ({}) ", state.snapshots.len()),
    ));
    frame.render_widget(table, area);
}

fn render_backup_table(frame: &mut Frame, area: Rect, state: &AppState) {
    let header = Row::new(vec![
        Cell::from("Backup ID"),
        Cell::from("Scope"),
        Cell::from("VMs"),
        Cell::from("Nets"),
        Cell::from("Disks"),
        Cell::from("Target"),
        Cell::from("Size"),
    ])
    .style(ORANGE_BOLD)
    .bottom_margin(1);

    let rows: Vec<Row> = state
        .backups
        .iter()
        .enumerate()
        .map(|(i, b)| {
            let scope_style = if b.vm_filter == "all" {
                Style::new().fg(Color::Blue)
            } else {
                Style::new().fg(Color::Green)
            };
            let disk_text = if b.with_disks { "Yes" } else { "No" };
            let disk_style = if b.with_disks {
                Style::new().fg(Color::Yellow)
            } else {
                DIM_STYLE
            };
            let target_text = if b.nfs_target == "local" {
                "Local"
            } else {
                b.nfs_target.as_str()
            };
            let row = Row::new(vec![
                Cell::from(b.id.as_str()).style(NAME_STYLE),
                Cell::from(b.vm_filter.as_str()).style(scope_style),
                Cell::from(b.vm_count.to_string()).style(TEXT_STYLE),
                Cell::from(b.net_count.to_string()).style(TEXT_STYLE),
                Cell::from(disk_text).style(disk_style),
                Cell::from(target_text).style(DIM_STYLE),
                Cell::from(b.size.as_str()).style(TEXT_STYLE),
            ]);
            select_row(row, i, state.selected_index)
        })
        .collect();

    let table = Table::new(
        rows,
        [
            Constraint::Percentage(22),
            Constraint::Percentage(15),
            Constraint::Percentage(8),
            Constraint::Percentage(8),
            Constraint::Percentage(8),
            Constraint::Percentage(22),
            Constraint::Percentage(12),
        ],
    )
    .header(header)
    .column_spacing(1)
    .block(content_block(
        state,
        &format!(" Backups ({}) ", state.backups.len()),
    ));
    frame.render_widget(table, area);
}

fn render_events_table(frame: &mut Frame, area: Rect, state: &AppState) {
    let header = Row::new(vec![
        Cell::from("Time"),
        Cell::from("Action"),
        Cell::from("Target"),
        Cell::from("Result"),
    ])
    .style(ORANGE_BOLD)
    .bottom_margin(1);

    let rows: Vec<Row> = state
        .audit_events
        .iter()
        .rev()
        .enumerate()
        .map(|(i, evt)| {
            let result_color = if evt.result.starts_with("ERROR") {
                ERROR_COLOR
            } else {
                SUCCESS_COLOR
            };
            let row = Row::new(vec![
                Cell::from(evt.timestamp.as_str()).style(DIM_STYLE),
                Cell::from(evt.action.as_str()).style(NAME_STYLE),
                Cell::from(evt.target.as_str()).style(TEXT_STYLE),
                Cell::from(evt.result.as_str()).style(Style::new().fg(result_color)),
            ]);
            select_row(row, i, state.selected_index)
        })
        .collect();

    let table = Table::new(
        rows,
        [
            Constraint::Percentage(25),
            Constraint::Percentage(20),
            Constraint::Percentage(30),
            Constraint::Percentage(25),
        ],
    )
    .header(header)
    .column_spacing(1)
    .block(content_block(
        state,
        &format!(" Events ({}) ", state.audit_events.len()),
    ));
    frame.render_widget(table, area);
}

fn render_node_view(frame: &mut Frame, area: Rect, state: &AppState) {
    let chunks = Layout::vertical([Constraint::Length(5), Constraint::Min(0)]).split(area);

    let d = &state.dashboard;
    let dash_lines = vec![
        Line::from(vec![
            Span::styled(" VMs: ", ORANGE_BOLD),
            Span::styled(format!("{} total", d.total_vms), TEXT_STYLE),
            Span::raw("  "),
            Span::styled(
                format!("{} running", d.running_vms),
                SUCCESS_STYLE.add_modifier(Modifier::BOLD),
            ),
            Span::raw("  "),
            Span::styled(
                format!("{} stopped", d.stopped_vms),
                Style::new().fg(ERROR_COLOR),
            ),
            if d.paused_vms > 0 {
                Span::styled(
                    format!("  {} paused", d.paused_vms),
                    Style::new().fg(WARNING_COLOR),
                )
            } else {
                Span::raw("")
            },
        ]),
        Line::from(vec![
            Span::styled(" CPU: ", ORANGE_BOLD),
            Span::styled(format!("{} vCPUs", d.total_vcpus), TEXT_STYLE),
            Span::raw("    "),
            Span::styled("Memory: ", ORANGE_BOLD),
            Span::styled(format!("{} MB", d.total_memory_mb), TEXT_STYLE),
        ]),
        Line::from(vec![
            Span::styled(" Net: ", ORANGE_BOLD),
            Span::styled(
                format!("{}/{}", d.active_networks, d.total_networks),
                INFO_STYLE,
            ),
            Span::raw("    "),
            Span::styled("Storage: ", ORANGE_BOLD),
            Span::styled(format!("{}/{}", d.active_pools, d.total_pools), INFO_STYLE),
            Span::raw("    "),
            Span::styled("Snap: ", ORANGE_BOLD),
            Span::styled(d.total_snapshots.to_string(), TEXT_STYLE),
        ]),
    ];

    let dash = Paragraph::new(dash_lines)
        .style(TEXT_STYLE)
        .block(content_block(state, " Dashboard "));
    frame.render_widget(dash, chunks[0]);

    let text = if let Some(ref node) = state.node_info {
        vec![
            kv_line("Hostname:       ", &node.hostname),
            kv_line(
                "Hypervisor:     ",
                &format!("{} {}", node.hypervisor, node.hypervisor_version),
            ),
            kv_line("Libvirt:        ", &node.lib_version),
            Line::from(""),
            kv_line("CPU Model:      ", &node.cpu_model),
            kv_line(
                "CPU Layout:     ",
                &format!(
                    "{} socket(s) x {} core(s) x {} thread(s)",
                    node.cpu_sockets, node.cpu_cores, node.cpu_threads
                ),
            ),
            kv_line("NUMA Nodes:     ", &node.numa_nodes.to_string()),
            Line::from(""),
            kv_line(
                "Total Memory:   ",
                &format!(
                    "{} MB ({:.1} GB)",
                    node.memory_mb,
                    node.memory_mb as f64 / 1024.0
                ),
            ),
        ]
    } else {
        vec![Line::from(Span::styled("Loading node info...", TEXT_STYLE))]
    };

    let paragraph = Paragraph::new(text)
        .style(TEXT_STYLE)
        .block(content_block(state, " Node Info "));
    frame.render_widget(paragraph, chunks[1]);
}

// ── Breadcrumb navigation ───────────────────────────────────────────────

fn render_breadcrumb(frame: &mut Frame, area: Rect, state: &AppState) {
    let pool_name = state.browsing_pool.as_deref().unwrap_or("?");
    let line = Line::from(vec![
        Span::styled(" Storage", DARK_ORANGE_STYLE),
        Span::styled(" \u{203a} ", ORANGE_BOLD),
        Span::styled(pool_name, NAME_BOLD),
        Span::styled(" \u{203a} ", ORANGE_BOLD),
        Span::styled("Volumes", TEXT_STYLE),
    ]);
    frame.render_widget(Paragraph::new(line), area);
}

fn render_volume_table(frame: &mut Frame, area: Rect, state: &AppState) {
    let pool_name = state.browsing_pool.as_deref().unwrap_or("?");

    let header = Row::new(vec![
        Cell::from("Name"),
        Cell::from("Type"),
        Cell::from("Cap (GB)"),
        Cell::from("Used (GB)"),
        Cell::from("Path"),
    ])
    .style(ORANGE_BOLD)
    .bottom_margin(1);

    let rows: Vec<Row> = state
        .volumes
        .iter()
        .enumerate()
        .map(|(i, vol)| {
            let row = Row::new(vec![
                Cell::from(vol.name.as_str()).style(NAME_STYLE),
                Cell::from(vol.vol_type.as_str()).style(TEXT_STYLE),
                Cell::from(format!("{:.1}", vol.capacity_gb)).style(TEXT_STYLE),
                Cell::from(format!("{:.1}", vol.allocation_gb)).style(TEXT_STYLE),
                Cell::from(vol.path.as_str()).style(DIM_STYLE),
            ]);
            select_row(row, i, state.selected_index)
        })
        .collect();

    let table = Table::new(
        rows,
        [
            Constraint::Percentage(20),
            Constraint::Percentage(10),
            Constraint::Percentage(15),
            Constraint::Percentage(15),
            Constraint::Percentage(40),
        ],
    )
    .header(header)
    .column_spacing(1)
    .block(content_block(
        state,
        &format!(
            " Volumes in '{}' ({}) - Bksp:back ",
            pool_name,
            state.volumes.len()
        ),
    ));
    frame.render_widget(table, area);
}

// ── Log / XML overlay views ─────────────────────────────────────────────

fn render_log_view(frame: &mut Frame, area: Rect, state: &AppState) {
    let lines: Vec<Line> = state
        .log_content
        .lines()
        .map(|l| {
            let style = if l.starts_with("\u{2500}\u{2500}") || l.starts_with("──") {
                ORANGE_BOLD
            } else if l.contains("error") || l.contains("ERROR") || l.contains("fail") {
                Style::new().fg(ERROR_COLOR)
            } else if l.contains("warn") || l.contains("WARN") {
                Style::new().fg(WARNING_COLOR)
            } else {
                TEXT_STYLE
            };
            Line::from(Span::styled(l.to_string(), style))
        })
        .collect();

    let log_title = if state.content_overlay_caption.is_empty() {
        " Logs (j/k:scroll  Esc:close) "
    } else {
        &state.content_overlay_caption
    };
    let paragraph = Paragraph::new(lines)
        .block(themed_block(log_title))
        .scroll((state.scroll_offset, 0));
    frame.render_widget(paragraph, area);
}

fn render_xml_view(frame: &mut Frame, area: Rect, state: &AppState) {
    let lines: Vec<Line> = state
        .xml_content
        .lines()
        .map(|l| {
            let style = if l.trim_start().starts_with('<') && l.contains("</") {
                TEXT_STYLE
            } else if l.trim_start().starts_with('<') {
                NAME_STYLE
            } else {
                DIM_STYLE
            };
            Line::from(Span::styled(l, style))
        })
        .collect();

    let xml_title = if state.content_overlay_caption.is_empty() {
        " XML (j/k:scroll  Esc:close) "
    } else {
        &state.content_overlay_caption
    };
    let paragraph = Paragraph::new(lines)
        .block(themed_block(xml_title))
        .scroll((state.scroll_offset, 0));
    frame.render_widget(paragraph, area);
}

// ── Notification toast ──────────────────────────────────────────────────

fn render_notification(frame: &mut Frame, area: Rect, msg: &str, level: NotifyLevel) {
    let (icon, color, border_color) = match level {
        NotifyLevel::Success => ("\u{2713} ", SUCCESS_COLOR, SUCCESS_COLOR),
        NotifyLevel::Error => ("\u{2717} ", ERROR_COLOR, ERROR_COLOR),
        NotifyLevel::Warning => ("\u{26a0} ", WARNING_COLOR, WARNING_COLOR),
        NotifyLevel::Info => ("\u{2139} ", INFO_COLOR, INFO_COLOR),
    };

    let display = format!("{icon}{msg}");
    let width = (display.len() as u16 + 4).min(area.width.saturating_sub(4));
    let x = area.width.saturating_sub(width + 2);
    let toast_area = Rect {
        x,
        y: 1,
        width,
        height: 3,
    };

    frame.render_widget(Clear, toast_area);

    let block = Block::new()
        .borders(Borders::ALL)
        .border_style(Style::new().fg(border_color).add_modifier(Modifier::BOLD))
        .style(Style::new().bg(Color::Black));

    let paragraph = Paragraph::new(Line::from(Span::styled(
        display,
        Style::new().fg(color).add_modifier(Modifier::BOLD),
    )))
    .block(block);

    frame.render_widget(paragraph, toast_area);
}

// ── Context menu overlay ────────────────────────────────────────────────

fn render_context_menu(frame: &mut Frame, area: Rect, state: &AppState) {
    const VM_ACTIONS: &[(&str, &str)] = &[
        ("s", "Start"),
        ("x", "Stop (force)"),
        ("h", "Shutdown"),
        ("b", "Reboot"),
        ("p", "Pause"),
        ("u", "Resume"),
        ("d", "Delete"),
        ("o", "Clone"),
        ("v", "Virt-viewer"),
        ("c", "Console"),
        ("y", "XML view"),
        ("n", "New VM"),
    ];
    const NET_ACTIONS: &[(&str, &str)] = &[
        ("a", "Start"),
        ("z", "Stop"),
        ("d", "Delete"),
        ("t", "Toggle autostart"),
        ("y", "XML view"),
    ];
    const POOL_ACTIONS: &[(&str, &str)] = &[
        ("a", "Start"),
        ("z", "Stop"),
        ("r", "Refresh"),
        ("t", "Toggle autostart"),
        ("d", "Delete volume"),
    ];
    const SNAP_ACTIONS: &[(&str, &str)] =
        &[("R", "Revert"), ("d", "Delete"), ("n", "New snapshot")];

    let items: &[(&str, &str)] = match state.sidebar_resource_view() {
        ResourceView::VirtualMachines => VM_ACTIONS,
        ResourceView::Networks => NET_ACTIONS,
        ResourceView::StoragePools => POOL_ACTIONS,
        ResourceView::Snapshots => SNAP_ACTIONS,
        _ => &[],
    };

    let height = (items.len() + 2).min(area.height as usize) as u16;
    let menu_area = Rect {
        x: area.width / 2 - 15,
        y: area.height / 2 - height / 2,
        width: 30,
        height,
    };
    frame.render_widget(Clear, menu_area);

    let lines: Vec<Line> = items
        .iter()
        .map(|(key, desc)| {
            Line::from(vec![
                Span::styled(format!("  {key}  "), ORANGE_BOLD),
                Span::styled(*desc, TEXT_STYLE),
            ])
        })
        .collect();

    frame.render_widget(
        Paragraph::new(lines).block(dialog_block(" Actions ", ORANGE_BOLD)),
        menu_area,
    );
}

// ── Confirmation dialog ─────────────────────────────────────────────────

fn render_confirmation_dialog(frame: &mut Frame, area: Rect, state: &AppState) {
    if let Some(ref dialog) = state.confirm_dialog {
        let dialog_area = centered_rect(50, 30, area);
        frame.render_widget(Clear, dialog_area);

        let lines = vec![
            Line::from(""),
            Line::from(Span::styled(&dialog.resource_name, NAME_BOLD)),
            Line::from(""),
            Line::from(Span::styled(&dialog.message, TEXT_STYLE)),
            Line::from(""),
            Line::from(vec![
                Span::styled(
                    "  [y] ",
                    Style::new().fg(ERROR_COLOR).add_modifier(Modifier::BOLD),
                ),
                Span::styled("Confirm", TEXT_STYLE),
                Span::raw("    "),
                Span::styled("[n] ", SUCCESS_STYLE.add_modifier(Modifier::BOLD)),
                Span::styled("Cancel", TEXT_STYLE),
            ]),
        ];

        let error_bold = Style::new().fg(ERROR_COLOR).add_modifier(Modifier::BOLD);
        frame.render_widget(
            Paragraph::new(lines).block(dialog_block(&format!(" {} ", dialog.title), error_bold)),
            dialog_area,
        );
    }
}

// ── Help overlay ────────────────────────────────────────────────────────

fn render_help_overlay(frame: &mut Frame, area: Rect, state: &AppState) {
    let help_area = centered_rect(65, 85, area);
    frame.render_widget(Clear, help_area);

    let lines = vec![
        Line::from(Span::styled("Machina — Keyboard Shortcuts", ORANGE_BOLD)),
        Line::from(""),
        help_section("Panel Navigation"),
        help_line("h/Left  Focus sidebar    l/Right  Focus content"),
        help_line("j/Down  Move down        k/Up     Move up"),
        help_line("g  Top    G  Bottom      Tab/BackTab  Cycle sub-tabs"),
        help_line("1  Summary  2  Monitor   3  Configure  (content sub-tabs)"),
        Line::from(""),
        help_section("Sidebar"),
        help_line("Space/Enter  Expand/collapse category"),
        help_line("Enter  Select object (loads details in content)"),
        Line::from(""),
        help_section("VM Actions"),
        help_line("s  Start    x  Stop (force)    H  Shutdown (graceful)"),
        help_line("b  Reboot   p  Pause           u  Resume"),
        help_line("d  Delete   o  Clone hint      t  Toggle autostart"),
        help_line("n  Packer hint (new images)    y  XML view"),
        help_line("l  View logs  v  Virt-viewer  V  noVNC  c  Console"),
        Line::from(""),
        help_section("Multi-select (VMs)"),
        help_line("Space  Toggle select    A  Select all    Esc  Clear"),
        help_line("Then s/x/H/b/p/u/d to batch operate"),
        Line::from(""),
        help_section("Network Actions"),
        help_line("a  Start    z  Stop    d  Delete    t  Toggle autostart"),
        help_line("y  XML view"),
        Line::from(""),
        help_section("Storage Pool Actions"),
        help_line("a  Start    z  Stop    r  Refresh pool    t  Toggle autostart"),
        help_line("Enter  Browse volumes    Backspace  Go back"),
        help_line("d  Delete volume (in volume browser)"),
        Line::from(""),
        help_section("Snapshot Actions"),
        help_line("R  Revert snapshot    d  Delete snapshot    n  New snapshot"),
        Line::from(""),
        help_section("General"),
        help_line("/  Search (fuzzy)  :  Command  r  Refresh  Ctrl+Space  Menu"),
        help_line("?/F1  Help    q/Esc  Quit"),
        Line::from(""),
        help_section("Backup Commands"),
        help_line(":backups  Browse backups"),
        help_line(":backup run  Backup all VMs"),
        help_line(":backup run <vm>  Backup single VM"),
        help_line(":backup restore <id>  Restore from backup"),
        help_line(":backup delete <id>  Delete a backup"),
        Line::from(""),
        help_section("Commands"),
        help_line(":vms :net :storage :snap :events :node :backups :quit"),
        help_line(":create  :clone <s> <n>  :snap <vm> <n>"),
        help_line(":template <tmpl> <n>  :rename <old> <new>"),
        help_line(":resize <n> vcpus|memory <v>"),
        Line::from(""),
        help_section("Browse / KubeVirt (daemon API)"),
        help_line(":browse  :browse /path/on/hypervisor"),
        help_line(":kubevirt-bundle <vm>  YAML in scroll view"),
        help_line(":kubevirt-apply <vm>  :kubevirt-upload <vm>  :kubevirt-start <vm>"),
        help_line("(upload/start need [kubevirt] exec_enabled=true + kubeconfig on daemon host)"),
        Line::from(""),
        help_section("OpenStack (Nova/Glance) — matches web UI"),
        help_line(":openstack | :os  status   :openstack test"),
        help_line(":openstack list  :openstack images  :openstack flavors"),
        help_line(":openstack networks  :openstack keypairs"),
        help_line(":openstack create  interactive wizard (flavor/image/network)"),
        help_line(":openstack create <name> <flavor> [image] [network]  one-shot"),
        help_line(":openstack get <id>"),
        help_line(":openstack start|stop|reboot|pause|unpause|suspend|resume <id>"),
        help_line(":openstack delete <id>  :openstack snapshot <id> <image-name>"),
        help_line(":openstack resize <id> <flavor>  :openstack confirm-resize <id>"),
        help_line(":openstack revert-resize <id>  :openstack quotas  :openstack snapshots"),
        help_line(":openstack console <id>"),
        help_line(":openstack export <id>  :openstack image-delete <id>"),
        help_line(":openstack volumes | volumes-json  instance-volumes <id>"),
        help_line(":openstack attach|detach <inst> <vol>  fips | instance-fips <id>"),
        help_line(":openstack fip-associate <inst> <fip>  fip-new <inst> <network>"),
        help_line(":openstack fip-dissociate <fip>  sg-add|sg-remove <inst> <sg>"),
        help_line(":openstack reboot-soft <id>"),
        help_line("Sidebar: + Create instance (Enter) · Glance images · instances"),
        help_line("Wizard: j/k pick · Enter next · n skip image/key · Esc cancel"),
        help_line("OpenStack instance keys: s/x/b/d/l"),
        Line::from(""),
        help_section("About — Zyvor"),
        help_line("https://zyvor.dev  ·  https://zyvor.dev/machina"),
        help_line("© 2026 Zyvor — proprietary. Docs: zyvor.dev/docs/products"),
        help_line("Glance upload / libvirt push / migrations: use Machina web UI"),
        Line::from(""),
        Line::from(Span::styled(
            "j/k:scroll  any other key:close",
            DARK_ORANGE_STYLE,
        )),
    ];

    frame.render_widget(
        Paragraph::new(lines)
            .style(TEXT_STYLE)
            .block(dialog_block(" Help ", ORANGE_BOLD))
            .scroll((state.help_scroll, 0)),
        help_area,
    );
}

fn help_section(title: &str) -> Line<'_> {
    Line::from(Span::styled(
        title,
        NAME_BOLD.add_modifier(Modifier::UNDERLINED),
    ))
}

fn help_line(text: &str) -> Line<'_> {
    Line::from(Span::styled(format!("  {text}"), TEXT_STYLE))
}

// ── Recent tasks bar ────────────────────────────────────────────────────

fn render_recent_tasks_bar(frame: &mut Frame, area: Rect, state: &AppState) {
    let mut spans: Vec<Span> = vec![Span::styled(
        " Tasks: ",
        DARK_ORANGE_STYLE.add_modifier(Modifier::BOLD),
    )];

    let recent: Vec<&_> = state.audit_events.iter().rev().take(3).collect();
    if recent.is_empty() {
        spans.push(Span::styled("(none)", DIM_STYLE));
    } else {
        for (i, evt) in recent.iter().enumerate() {
            if i > 0 {
                spans.push(Span::styled(" | ", DARK_ORANGE_STYLE));
            }
            let result_color = if evt.result.starts_with("ERROR") {
                ERROR_COLOR
            } else {
                SUCCESS_COLOR
            };
            spans.push(Span::styled(&evt.action, NAME_STYLE));
            spans.push(Span::styled(format!(" {} ", evt.target), TEXT_STYLE));
            spans.push(Span::styled(&evt.result, Style::new().fg(result_color)));
        }
    }

    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

// ── Bottom bar (key hints / search / command) ───────────────────────────

fn render_bottom_bar(frame: &mut Frame, area: Rect, state: &AppState) {
    let line = match state.input_mode {
        InputMode::Search => Line::from(vec![
            Span::styled("/", ORANGE_BOLD),
            Span::styled(
                &state.search_query,
                TEXT_STYLE.add_modifier(Modifier::UNDERLINED),
            ),
            Span::styled("_", LABEL_STYLE),
        ]),
        InputMode::Command => Line::from(vec![
            Span::styled(":", ORANGE_BOLD),
            Span::styled(
                &state.command_input,
                TEXT_STYLE.add_modifier(Modifier::UNDERLINED),
            ),
            Span::styled("_", LABEL_STYLE),
        ]),
        InputMode::Confirmation => Line::from(Span::styled("", Style::new().fg(ERROR_COLOR))),
        InputMode::OpenStackWizard => {
            let name = state
                .openstack_create_wizard
                .as_ref()
                .map(|w| w.name.as_str())
                .unwrap_or("");
            Line::from(vec![
                Span::styled("name: ", ORANGE_BOLD),
                Span::styled(name, TEXT_STYLE.add_modifier(Modifier::UNDERLINED)),
                Span::styled("_  Enter next · Esc cancel", DARK_ORANGE_STYLE),
            ])
        }
        InputMode::Normal => {
            if state.view_mode == ViewMode::OpenStackCreate {
                Line::from(Span::styled(
                    "OpenStack create · j/k · Enter · n skip · Backspace back · Esc cancel",
                    DARK_ORANGE_STYLE,
                ))
            } else {
                build_context_help_line(state)
            }
        }
    };
    frame.render_widget(Paragraph::new(line), area);
}

fn build_context_help_line(state: &AppState) -> Line<'static> {
    let mut spans: Vec<Span> = Vec::new();

    let add_hint = |spans: &mut Vec<Span>, key: &str, desc: &str| {
        spans.push(Span::styled(key.to_string(), ORANGE_BOLD));
        spans.push(Span::styled(format!(":{desc} "), DARK_ORANGE_STYLE));
    };

    add_hint(&mut spans, "?", "help");
    add_hint(&mut spans, "/", "search");

    match state.focus {
        Focus::Sidebar => {
            add_hint(&mut spans, "j/k", "nav");
            add_hint(&mut spans, "Spc", "expand");
            add_hint(&mut spans, "Enter", "select");
            add_hint(&mut spans, "l", "content");

            // Show relevant action hints based on sidebar selection
            match state.selected_sidebar_item() {
                Some(SidebarItem::Vm(name)) => {
                    let vm_state = state.vm_state_str(name);
                    match vm_state {
                        "shutoff" => {
                            add_hint(&mut spans, "s", "start");
                            add_hint(&mut spans, "d", "del");
                        }
                        "running" => {
                            add_hint(&mut spans, "x", "stop");
                            add_hint(&mut spans, "p", "pause");
                        }
                        "paused" => {
                            add_hint(&mut spans, "u", "resume");
                        }
                        _ => {
                            add_hint(&mut spans, "s", "start");
                        }
                    }
                }
                Some(SidebarItem::Network(_)) => {
                    add_hint(&mut spans, "a", "start");
                    add_hint(&mut spans, "z", "stop");
                    add_hint(&mut spans, "d", "del");
                    add_hint(&mut spans, "t", "autostart");
                    add_hint(&mut spans, "y", "xml");
                }
                Some(SidebarItem::StoragePool(_)) => {
                    add_hint(&mut spans, "a", "start");
                    add_hint(&mut spans, "z", "stop");
                    add_hint(&mut spans, "r", "refresh");
                    add_hint(&mut spans, "t", "autostart");
                }
                Some(SidebarItem::Snapshot(_, _)) => {
                    add_hint(&mut spans, "R", "revert");
                    add_hint(&mut spans, "d", "delete");
                }
                Some(SidebarItem::Category(SidebarCategory::Snapshots)) => {
                    add_hint(&mut spans, "n", "new");
                }
                Some(SidebarItem::OpenStackInstance(_)) => {
                    add_hint(&mut spans, "s", "start");
                    add_hint(&mut spans, "x", "stop");
                    add_hint(&mut spans, "d", "del");
                }
                Some(SidebarItem::OpenStackCreate) => {
                    add_hint(&mut spans, "Enter", "wizard");
                }
                _ => {}
            }
        }
        Focus::Content => {
            add_hint(&mut spans, "h", "sidebar");
            add_hint(&mut spans, "Tab", "sub-tab");
            add_hint(&mut spans, "j/k", "scroll");

            // Action hints based on what's shown in content
            match state.selected_sidebar_item() {
                Some(SidebarItem::Vm(name)) => {
                    let vm_state = state.vm_state_str(name);
                    match vm_state {
                        "shutoff" => {
                            add_hint(&mut spans, "s", "start");
                        }
                        "running" => {
                            add_hint(&mut spans, "x", "stop");
                            add_hint(&mut spans, "v", "vnc");
                        }
                        "paused" => {
                            add_hint(&mut spans, "u", "resume");
                        }
                        _ => {}
                    }
                }
                Some(SidebarItem::Category(SidebarCategory::VirtualMachines)) => {
                    add_hint(&mut spans, "n", "new");
                }
                Some(SidebarItem::Category(SidebarCategory::Networks)) => {
                    add_hint(&mut spans, "d", "del");
                    add_hint(&mut spans, "t", "autostart");
                    add_hint(&mut spans, "y", "xml");
                }
                Some(SidebarItem::Category(SidebarCategory::Storage)) => {
                    if state.browsing_pool.is_some() {
                        add_hint(&mut spans, "d", "del vol");
                    } else {
                        add_hint(&mut spans, "t", "autostart");
                    }
                }
                Some(SidebarItem::Category(SidebarCategory::Snapshots)) => {
                    add_hint(&mut spans, "n", "new");
                    add_hint(&mut spans, "d", "del");
                }
                Some(SidebarItem::OpenStackInstance(_)) => {
                    add_hint(&mut spans, "s", "start");
                    add_hint(&mut spans, "x", "stop");
                    add_hint(&mut spans, "b", "reboot");
                    add_hint(&mut spans, "l", "log");
                }
                _ => {}
            }
        }
    }

    Line::from(spans)
}

// ── OpenStack panels (parity with web OpenStack pages) ──────────────────

fn render_openstack_overview(frame: &mut Frame, area: Rect, state: &AppState) {
    let st = state.openstack_status.as_ref();
    let status_line = match st {
        Some(s) if s.compute_reachable => {
            format!(
                "Keystone+Nova+Glance OK · cloud={} · instances={} images={}",
                s.cloud_name,
                s.instance_count.unwrap_or(state.openstack_instances.len()),
                s.image_count.unwrap_or(state.openstack_images.len())
            )
        }
        Some(s) if s.reachable || s.keystone_reachable => {
            format!(
                "Keystone OK · compute/glance may be down · {}",
                s.error.as_deref().unwrap_or("see :openstack test")
            )
        }
        Some(s) if s.configured => format!(
            "Configured · not connected · {}",
            s.error
                .as_deref()
                .unwrap_or("run openstack-wire-cloud.sh on host")
        ),
        _ => "OpenStack not configured ([openstack] in /etc/machina/config.toml)".to_string(),
    };

    let header = vec![
        Line::from(Span::styled("OpenStack overview", ORANGE_BOLD)),
        Line::from(Span::styled(status_line, TEXT_STYLE)),
        Line::from(""),
    ];

    let mut rows: Vec<Row> = Vec::new();
    rows.push(Row::new(vec![
        Cell::from(Span::styled("NAME", LABEL_STYLE)),
        Cell::from(Span::styled("STATUS", LABEL_STYLE)),
        Cell::from(Span::styled("POWER", LABEL_STYLE)),
        Cell::from(Span::styled("ID", LABEL_STYLE)),
    ]));
    for inst in &state.openstack_instances {
        rows.push(Row::new(vec![
            Cell::from(inst.name.clone()),
            Cell::from(inst.status.clone()),
            Cell::from(inst.power_state.clone()),
            Cell::from(truncate_str(&inst.id, 36)),
        ]));
    }

    let table = Table::new(
        rows,
        [
            Constraint::Percentage(28),
            Constraint::Length(12),
            Constraint::Length(10),
            Constraint::Min(20),
        ],
    )
    .block(content_block(state, " OpenStack instances "))
    .column_spacing(1);

    let chunks = Layout::vertical([Constraint::Length(3), Constraint::Min(0)]).split(area);
    frame.render_widget(Paragraph::new(header), chunks[0]);
    frame.render_widget(table, chunks[1]);
}

fn render_openstack_images_table(frame: &mut Frame, area: Rect, state: &AppState) {
    let mut rows: Vec<Row> = Vec::new();
    rows.push(Row::new(vec![
        Cell::from(Span::styled("NAME", LABEL_STYLE)),
        Cell::from(Span::styled("STATUS", LABEL_STYLE)),
        Cell::from(Span::styled("MIN DISK", LABEL_STYLE)),
        Cell::from(Span::styled("ID", LABEL_STYLE)),
    ]));
    for img in &state.openstack_images {
        rows.push(Row::new(vec![
            Cell::from(img.name.clone()),
            Cell::from(img.status.clone()),
            Cell::from(format!("{} GB", img.min_disk_gb)),
            Cell::from(truncate_str(&img.id, 36)),
        ]));
    }
    let table = Table::new(
        rows,
        [
            Constraint::Percentage(35),
            Constraint::Length(12),
            Constraint::Length(10),
            Constraint::Min(18),
        ],
    )
    .block(content_block(state, " Glance images "))
    .column_spacing(1);
    frame.render_widget(table, area);
}

fn render_openstack_instance_detail(frame: &mut Frame, area: Rect, state: &AppState, id: &str) {
    let inst = state
        .openstack_instance_detail
        .as_ref()
        .filter(|i| i.id == id)
        .or_else(|| state.find_openstack_instance(id));

    let lines = match inst {
        Some(i) => {
            let ips = if i.ip_addresses.is_empty() {
                "—".to_string()
            } else {
                i.ip_addresses.join(", ")
            };
            let mut lines = vec![
                Line::from(Span::styled(i.name.clone(), NAME_BOLD)),
                Line::from(""),
                Line::from(vec![
                    Span::styled("  ID:     ", LABEL_STYLE),
                    Span::raw(i.id.as_str()),
                ]),
                Line::from(vec![
                    Span::styled("  Status: ", LABEL_STYLE),
                    Span::raw(i.status.as_str()),
                ]),
                Line::from(vec![
                    Span::styled("  Power:  ", LABEL_STYLE),
                    Span::raw(i.power_state.as_str()),
                ]),
                Line::from(vec![
                    Span::styled("  Flavor: ", LABEL_STYLE),
                    Span::raw(i.flavor_name.as_deref().unwrap_or("—")),
                ]),
                Line::from(vec![
                    Span::styled("  Image:  ", LABEL_STYLE),
                    Span::raw(i.image_id.as_deref().unwrap_or("—")),
                ]),
                Line::from(vec![
                    Span::styled("  IPs:    ", LABEL_STYLE),
                    Span::raw(ips),
                ]),
                Line::from(vec![
                    Span::styled("  AZ:     ", LABEL_STYLE),
                    Span::raw(i.availability_zone.as_str()),
                ]),
                Line::from(vec![
                    Span::styled("  SGs:    ", LABEL_STYLE),
                    Span::raw(if i.security_groups.is_empty() {
                        "—".to_string()
                    } else {
                        i.security_groups.join(", ")
                    }),
                ]),
                Line::from(""),
                Line::from(Span::styled("  Attached volumes", LABEL_STYLE)),
            ];
            for v in &state.openstack_instance_volumes {
                lines.push(Line::from(format!(
                    "    {}  {} GB  {}  {}",
                    v.device,
                    v.size_gb,
                    v.name,
                    truncate_str(&v.id, 12)
                )));
            }
            if state.openstack_instance_volumes.is_empty() {
                lines.push(Line::from("    (none)"));
            }
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled("  Floating IPs", LABEL_STYLE)));
            for f in &state.openstack_instance_fips {
                lines.push(Line::from(format!(
                    "    {}  {}  {}",
                    f.address,
                    f.status,
                    truncate_str(&f.id, 12)
                )));
            }
            if state.openstack_instance_fips.is_empty() {
                lines.push(Line::from("    (none)"));
            }
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "  s start  x stop  b reboot  d delete  l console log",
                DARK_ORANGE_STYLE,
            )));
            lines
        }
        None => vec![Line::from(Span::styled(
            " Loading instance… (or run :openstack get <id>) ",
            DIM_STYLE,
        ))],
    };

    let p = Paragraph::new(lines)
        .block(content_block(state, " OpenStack instance "))
        .wrap(Wrap { trim: true })
        .scroll((state.content_scroll_offset, 0));
    frame.render_widget(p, area);
}

fn render_openstack_create_prompt(frame: &mut Frame, area: Rect, state: &AppState) {
    let lines = vec![
        Line::from(Span::styled("Create OpenStack instance", ORANGE_BOLD)),
        Line::from(""),
        Line::from(vec![
            Span::styled("Enter", ORANGE_BOLD),
            Span::raw(" on sidebar “+ Create instance”, or run "),
            Span::styled(":openstack create", NAME_STYLE),
        ]),
        Line::from(""),
        Line::from(Span::styled(
            "Wizard steps: name → flavor → image (optional) → network → keypair (optional) → confirm",
            DIM_STYLE,
        )),
        Line::from(Span::styled(
            "Matches web Create Instance flow when Nova/Neutron/Glance are reachable.",
            DIM_STYLE,
        )),
    ];
    let p = Paragraph::new(lines)
        .block(content_block(state, " OpenStack create "))
        .wrap(Wrap { trim: true });
    frame.render_widget(p, area);
}

fn render_openstack_create_wizard(frame: &mut Frame, area: Rect, state: &AppState) {
    let Some(wizard) = state.openstack_create_wizard.as_ref() else {
        return;
    };

    let popup = centered_rect(70, 80, area);
    frame.render_widget(Clear, popup);

    let step_title = match wizard.step {
        OpenStackCreateStep::Name => "1/6 Name",
        OpenStackCreateStep::Flavor => "2/6 Flavor",
        OpenStackCreateStep::Image => "3/6 Image (optional)",
        OpenStackCreateStep::Network => "4/6 Network",
        OpenStackCreateStep::Keypair => "5/6 Keypair (optional)",
        OpenStackCreateStep::Confirm => "6/6 Confirm",
    };

    let block = Block::new()
        .borders(Borders::ALL)
        .border_style(Style::new().fg(ORANGE))
        .title(format!(" Create instance — {step_title} "))
        .title_style(ORANGE_BOLD)
        .style(Style::new().bg(Color::Black));

    let inner = block.inner(popup);
    frame.render_widget(block, popup);

    match wizard.step {
        OpenStackCreateStep::Name => {
            let p = Paragraph::new(vec![
                Line::from("Type the instance name in the bottom bar."),
                Line::from(""),
                Line::from(vec![
                    Span::styled("Name: ", LABEL_STYLE),
                    Span::styled(&wizard.name, NAME_BOLD),
                ]),
            ])
            .wrap(Wrap { trim: true });
            frame.render_widget(p, inner);
        }
        OpenStackCreateStep::Confirm => {
            let image = wizard
                .image_name()
                .map(str::to_string)
                .unwrap_or_else(|| "(none)".to_string());
            let network = wizard
                .network_name()
                .map(str::to_string)
                .unwrap_or_else(|| "(default)".to_string());
            let key = wizard
                .key_name()
                .map(str::to_string)
                .unwrap_or_else(|| "(none)".to_string());
            let lines = vec![
                Line::from(vec![
                    Span::styled("Name:    ", LABEL_STYLE),
                    Span::styled(&wizard.name, NAME_BOLD),
                ]),
                Line::from(vec![
                    Span::styled("Flavor:  ", LABEL_STYLE),
                    Span::raw(wizard.flavor_name().unwrap_or("?")),
                ]),
                Line::from(vec![
                    Span::styled("Image:   ", LABEL_STYLE),
                    Span::raw(image),
                ]),
                Line::from(vec![
                    Span::styled("Network: ", LABEL_STYLE),
                    Span::raw(network),
                ]),
                Line::from(vec![Span::styled("Key:     ", LABEL_STYLE), Span::raw(key)]),
                Line::from(""),
                Line::from(Span::styled(
                    "Enter to create · Backspace to edit · Esc to cancel",
                    DIM_STYLE,
                )),
            ];
            let p = Paragraph::new(lines).wrap(Wrap { trim: true });
            frame.render_widget(p, inner);
        }
        step => {
            let (header, rows): (String, Vec<Row>) = match step {
                OpenStackCreateStep::Flavor => (
                    "vCPUs  RAM   Disk".to_string(),
                    wizard
                        .flavors
                        .iter()
                        .enumerate()
                        .map(|(i, f)| {
                            let style = if i == wizard.list_cursor {
                                Style::new().fg(LIGHT_ORANGE).add_modifier(Modifier::BOLD)
                            } else {
                                TEXT_STYLE
                            };
                            Row::new(vec![
                                Cell::from(f.name.as_str()).style(style),
                                Cell::from(format!("{}", f.vcpus)).style(style),
                                Cell::from(format!("{} MiB", f.ram_mb)).style(style),
                                Cell::from(format!("{} GB", f.disk_gb)).style(style),
                            ])
                        })
                        .collect(),
                ),
                OpenStackCreateStep::Image => (
                    "Status  Min disk".to_string(),
                    wizard
                        .images
                        .iter()
                        .enumerate()
                        .map(|(i, img)| {
                            let style = if i == wizard.list_cursor {
                                Style::new().fg(LIGHT_ORANGE).add_modifier(Modifier::BOLD)
                            } else {
                                TEXT_STYLE
                            };
                            Row::new(vec![
                                Cell::from(img.name.as_str()).style(style),
                                Cell::from(img.status.as_str()).style(style),
                                Cell::from(format!("{} GB", img.min_disk_gb)).style(style),
                            ])
                        })
                        .collect(),
                ),
                OpenStackCreateStep::Network => (
                    "Status  External".to_string(),
                    wizard
                        .networks
                        .iter()
                        .enumerate()
                        .map(|(i, n)| {
                            let style = if i == wizard.list_cursor {
                                Style::new().fg(LIGHT_ORANGE).add_modifier(Modifier::BOLD)
                            } else {
                                TEXT_STYLE
                            };
                            Row::new(vec![
                                Cell::from(n.name.as_str()).style(style),
                                Cell::from(n.status.as_str()).style(style),
                                Cell::from(if n.external { "yes" } else { "no" }).style(style),
                            ])
                        })
                        .collect(),
                ),
                OpenStackCreateStep::Keypair => (
                    "Fingerprint".to_string(),
                    wizard
                        .keypairs
                        .iter()
                        .enumerate()
                        .map(|(i, k)| {
                            let style = if i == wizard.list_cursor {
                                Style::new().fg(LIGHT_ORANGE).add_modifier(Modifier::BOLD)
                            } else {
                                TEXT_STYLE
                            };
                            Row::new(vec![
                                Cell::from(k.name.as_str()).style(style),
                                Cell::from(k.fingerprint.as_deref().unwrap_or("—")).style(style),
                            ])
                        })
                        .collect(),
                ),
                _ => (String::new(), vec![]),
            };

            if rows.is_empty() {
                let msg = match step {
                    OpenStackCreateStep::Image => {
                        "No Glance images — press n to skip, or Esc to cancel"
                    }
                    OpenStackCreateStep::Network => {
                        "No Neutron networks available — check Neutron on the host"
                    }
                    OpenStackCreateStep::Keypair => "No keypairs — press n to skip",
                    _ => "No items",
                };
                let p = Paragraph::new(Line::from(Span::styled(msg, WARNING_COLOR)));
                frame.render_widget(p, inner);
            } else {
                let widths = match step {
                    OpenStackCreateStep::Flavor => {
                        vec![
                            Constraint::Percentage(40),
                            Constraint::Length(6),
                            Constraint::Length(10),
                            Constraint::Length(8),
                        ]
                    }
                    OpenStackCreateStep::Image => {
                        vec![
                            Constraint::Percentage(50),
                            Constraint::Length(12),
                            Constraint::Length(10),
                        ]
                    }
                    OpenStackCreateStep::Network => {
                        vec![
                            Constraint::Percentage(50),
                            Constraint::Length(10),
                            Constraint::Length(10),
                        ]
                    }
                    OpenStackCreateStep::Keypair => {
                        vec![Constraint::Percentage(35), Constraint::Min(10)]
                    }
                    _ => vec![Constraint::Percentage(100)],
                };
                let header_cells: Vec<&str> = match step {
                    OpenStackCreateStep::Flavor => vec!["Flavor", "vCPU", "RAM", "Disk"],
                    OpenStackCreateStep::Image => vec!["Image", "Status", "Min disk"],
                    OpenStackCreateStep::Network => vec!["Network", "Status", "External"],
                    OpenStackCreateStep::Keypair => vec!["Keypair", "Fingerprint"],
                    _ => vec!["Name"],
                };
                let table = Table::new(rows, widths)
                    .header(Row::new(header_cells).style(ORANGE_BOLD).bottom_margin(0))
                    .column_spacing(1);
                frame.render_widget(table, inner);
                let hint_y = popup.y + popup.height.saturating_sub(2);
                if hint_y > popup.y {
                    let hint_area = Rect {
                        x: popup.x + 1,
                        y: hint_y,
                        width: popup.width.saturating_sub(2),
                        height: 1,
                    };
                    let skip = matches!(
                        step,
                        OpenStackCreateStep::Image | OpenStackCreateStep::Keypair
                    );
                    let hint = if skip {
                        format!("j/k · Enter select · n skip · {header}")
                    } else {
                        format!("j/k · Enter select · {header}")
                    };
                    frame.render_widget(
                        Paragraph::new(Span::styled(hint, DARK_ORANGE_STYLE)),
                        hint_area,
                    );
                }
            }
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn dialog_block(title: &str, border_style: Style) -> Block<'static> {
    Block::new()
        .borders(Borders::ALL)
        .border_style(border_style)
        .title(title.to_string())
        .title_style(border_style)
        .style(Style::new().bg(Color::Black))
}

fn state_indicator(vm_state: &str) -> &'static str {
    match vm_state {
        "running" => "\u{25cf}",
        "paused" => "\u{25d1}",
        _ => "\u{25cb}",
    }
}

fn themed_block(title: &str) -> Block<'static> {
    Block::new()
        .borders(Borders::ALL)
        .border_style(Style::new().fg(DARK_ORANGE))
        .title(title.to_string())
        .title_style(ORANGE_BOLD)
}

fn pct_color(pct: f64) -> Color {
    if pct > 90.0 {
        ERROR_COLOR
    } else if pct > 70.0 {
        WARNING_COLOR
    } else {
        SUCCESS_COLOR
    }
}

fn bool_label(val: bool) -> &'static str {
    if val {
        "yes"
    } else {
        "no"
    }
}

fn select_row(row: Row<'_>, idx: usize, selected: usize) -> Row<'_> {
    if idx == selected {
        row.style(NAME_BOLD)
    } else {
        row
    }
}

fn sidebar_item_style(is_selected: bool) -> Style {
    if is_selected {
        NAME_BOLD.bg(HIGHLIGHT_BG)
    } else {
        TEXT_STYLE
    }
}

fn state_color(state: &str) -> Color {
    match state {
        "running" => SUCCESS_COLOR,
        "shutoff" => ERROR_COLOR,
        "paused" => WARNING_COLOR,
        "crashed" => Color::Rgb(200, 50, 200),
        "inactive" => ERROR_COLOR,
        _ => Color::Rgb(150, 150, 150),
    }
}

fn vm_details_for<'a>(state: &'a AppState, vm_name: &str) -> Option<&'a machina_core::VmDetails> {
    state.vm_details.as_ref().filter(|d| d.name == vm_name)
}

fn load_hint_lines(what: &str) -> Vec<Line<'static>> {
    vec![
        Line::from(""),
        Line::from(vec![
            Span::styled("  Enter", ORANGE_BOLD),
            Span::styled(format!(" to load {what}"), DIM_STYLE),
        ]),
    ]
}

fn kv_line(key: &str, value: &str) -> Line<'static> {
    Line::from(vec![
        Span::styled(key.to_string(), LABEL_STYLE),
        Span::styled(value.to_string(), TEXT_STYLE),
    ])
}

fn section_header(title: &str) -> Line<'static> {
    Line::from(Span::styled(
        title.to_string(),
        NAME_BOLD.add_modifier(Modifier::UNDERLINED),
    ))
}

fn memory_bar(pct: f64) -> String {
    let filled = (pct / 10.0).round() as usize;
    (0..10)
        .map(|i| {
            if i < filled {
                let level = ((pct / 100.0) * 7.0).round() as usize;
                SPARKLINE_BLOCKS[level.min(7)]
            } else {
                '\u{2581}'
            }
        })
        .collect()
}

fn mini_sparkline(values: &VecDeque<f64>) -> String {
    if values.is_empty() {
        return String::new();
    }

    let min = values.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let range = if (max - min).abs() < 0.01 {
        1.0
    } else {
        max - min
    };

    values
        .iter()
        .map(|&v| {
            let normalized = ((v - min) / range * 7.0).round() as usize;
            SPARKLINE_BLOCKS[normalized.min(7)]
        })
        .collect()
}

fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else if max_len > 2 {
        let truncated: String = s.chars().take(max_len - 2).collect();
        format!("{truncated}..")
    } else {
        s.chars().take(max_len).collect()
    }
}

fn format_bytes(bytes: u64) -> String {
    machina_core::fmt::format_bytes(bytes)
}

fn centered_rect(percent_x: u16, percent_y: u16, area: Rect) -> Rect {
    let popup_layout = Layout::vertical([
        Constraint::Percentage((100 - percent_y) / 2),
        Constraint::Percentage(percent_y),
        Constraint::Percentage((100 - percent_y) / 2),
    ])
    .split(area);

    Layout::horizontal([
        Constraint::Percentage((100 - percent_x) / 2),
        Constraint::Percentage(percent_x),
        Constraint::Percentage((100 - percent_x) / 2),
    ])
    .split(popup_layout[1])[1]
}
