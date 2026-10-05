mod storage;
use serde::Serialize;
use tauri::{Emitter, Manager};
#[cfg(target_os = "linux")]
mod linux_desktop;

#[tauri::command]
fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let parsed = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") { return Err("Unsupported link protocol".into()); }
    app.opener().open_url(parsed.as_str(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn supports_window_positioning() -> bool {
    #[cfg(target_os = "linux")]
    { linux_desktop::supports_positioning() }
    #[cfg(not(target_os = "linux"))]
    { true }
}

mod window_constraints;
mod display_geometry;
mod reveal_shortcut;
mod update_probe;
mod popout_lifecycle;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorWorkArea {
    id: String,
    label: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[cfg(windows)]
fn work_area_at_point(x: i32, y: i32) -> Result<WorkArea, String> {
    use windows_sys::Win32::Foundation::{POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };

    let point = POINT { x, y };
    unsafe {
        let monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            rcMonitor: RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            rcWork: RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            dwFlags: 0,
        };
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return Err("Unable to read the Windows monitor work area".into());
        }
        Ok(WorkArea {
            x: info.rcWork.left,
            y: info.rcWork.top,
            width: (info.rcWork.right - info.rcWork.left) as u32,
            height: (info.rcWork.bottom - info.rcWork.top) as u32,
        })
    }
}

#[cfg(windows)]
fn timer_work_area(
    window: &tauri::WebviewWindow,
    monitor_id: Option<&str>,
) -> Result<WorkArea, String> {
    if let Some(index) = monitor_id
        .and_then(|value| value.strip_prefix("display:"))
        .and_then(|value| value.parse::<usize>().ok())
    {
        let monitors = window.available_monitors().map_err(|e| e.to_string())?;
        if let Some(monitor) = monitors.get(index) {
            return work_area_at_point(
                monitor.position().x + monitor.size().width as i32 / 2,
                monitor.position().y + monitor.size().height as i32 / 2,
            );
        }
    }
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    work_area_at_point(
        position.x + size.width as i32 / 2,
        position.y + size.height as i32 / 2,
    )
}

#[cfg(not(windows))]
fn timer_work_area(
    window: &tauri::WebviewWindow,
    monitor_id: Option<&str>,
) -> Result<WorkArea, String> {
    let explicit = monitor_id
        .and_then(|value| value.strip_prefix("display:"))
        .and_then(|value| value.parse::<usize>().ok())
        .and_then(|index| window.available_monitors().ok()?.get(index).cloned());
    let monitor = explicit
        .or(window.current_monitor().map_err(|e| e.to_string())?)
        .or(window.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or_else(|| "No monitor is available".to_string())?;
    Ok(WorkArea {
        x: monitor.work_area().position.x,
        y: monitor.work_area().position.y,
        width: monitor.work_area().size.width,
        height: monitor.work_area().size.height,
    })
}

#[tauri::command]
fn list_monitor_work_areas(app: tauri::AppHandle) -> Result<Vec<MonitorWorkArea>, String> {
    let window = app
        .get_webview_window("timer")
        .or_else(|| app.get_webview_window("main"))
        .ok_or_else(|| "No Shunhen window is available".to_string())?;
    window
        .available_monitors()
        .map_err(|e| e.to_string())?
        .iter()
        .enumerate()
        .map(|(index, monitor)| {
            #[cfg(windows)]
            let area = work_area_at_point(
                monitor.position().x + monitor.size().width as i32 / 2,
                monitor.position().y + monitor.size().height as i32 / 2,
            )?;
            #[cfg(not(windows))]
            let area = WorkArea {
                x: monitor.work_area().position.x,
                y: monitor.work_area().position.y,
                width: monitor.work_area().size.width,
                height: monitor.work_area().size.height,
            };
            Ok(MonitorWorkArea {
                id: format!("display:{}", index),
                label: monitor
                    .name()
                    .map(|name| format!("Display {} - {}", index + 1, name))
                    .unwrap_or_else(|| format!("Display {}", index + 1)),
                x: area.x,
                y: area.y,
                width: area.width,
                height: area.height,
            })
        })
        .collect()
}

fn clamped_timer_position(window: &tauri::WebviewWindow, x: i32, y: i32) -> Result<tauri::PhysicalPosition<i32>, String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let requested_monitor = monitors.iter().find(|monitor| {
        let position = monitor.position();
        let size = monitor.size();
        x >= position.x && y >= position.y && x < position.x + size.width as i32 && y < position.y + size.height as i32
    }).cloned();
    let monitor = requested_monitor.clone()
        .or(window.current_monitor().map_err(|e| e.to_string())?)
        .or(window.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or_else(|| "No monitor is available".to_string())?;
    let desired = if requested_monitor.is_some() { (x, y) } else { (monitor.position().x + 32, monitor.position().y + 32) };
    #[cfg(windows)]
    let area = work_area_at_point(monitor.position().x + monitor.size().width as i32 / 2, monitor.position().y + monitor.size().height as i32 / 2)?;
    #[cfg(not(windows))]
    let area = WorkArea { x: monitor.work_area().position.x, y: monitor.work_area().position.y, width: monitor.work_area().size.width, height: monitor.work_area().size.height };
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let max_x = (area.x + area.width as i32 - size.width as i32).max(area.x);
    let max_y = (area.y + area.height as i32 - size.height as i32).max(area.y);
    Ok(tauri::PhysicalPosition::new(desired.0.clamp(area.x, max_x), desired.1.clamp(area.y, max_y)))
}

fn ensure_timer_on_screen(window: &tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if !supports_window_positioning() { return Ok(()); }
    let position = window.outer_position().map_err(|e| e.to_string())?;
    window.set_position(clamped_timer_position(window, position.x, position.y)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_timer_popout(app: tauri::AppHandle, session_id: String, generation: u64, shortcut: Option<bool>) -> Result<(), String> {
    let managed = app.state::<popout_lifecycle::PopoutLifecycle>();
    let mut lifecycle = popout_lifecycle::lock(&managed)?;
    if shortcut.unwrap_or(false) && lifecycle.shortcut_disabled { return Ok(()); }
    if !lifecycle.active() || lifecycle.session_id.as_deref() != Some(session_id.as_str()) || lifecycle.generation != generation { return Ok(()); }
    if let Some(window) = app.get_webview_window("timer") {
        ensure_timer_on_screen(&window)?;
        if let Some(tab) = app.get_webview_window("timer-tab") { tab.hide().map_err(|e| e.to_string())?; }
        show_without_focus(&window)?;
        lifecycle.cancel_shortcut_reveal();
        lifecycle.requested = true;
        if shortcut.unwrap_or(false) && !lifecycle.pointer_inside && !lifecycle.shortcut_disabled { lifecycle.shortcut_reveal = Some(lifecycle.reveal_sequence); }
        let _ = window.emit("focus://popout-shown", ());
        return Ok(());
    }
    Err("The configured timer window is unavailable".into())
}

#[tauri::command]
fn open_timer_menu(app: tauri::AppHandle, view: Option<String>) -> Result<(), String> {
    let managed = app.state::<popout_lifecycle::PopoutLifecycle>();
    let mut lifecycle = popout_lifecycle::lock(&managed)?;
    if !lifecycle.requested || !lifecycle.active() { return Ok(()); }
    lifecycle.cancel_shortcut_reveal();
    let _ = app.emit_to("main", "focus://cancel-shortcut-reveal", lifecycle.reveal_sequence);
    let timer = app.get_webview_window("timer").ok_or_else(|| "The timer window is unavailable".to_string())?;
    let menu = app.get_webview_window("timer-menu").ok_or_else(|| "The timer menu is unavailable".to_string())?;
    if supports_window_positioning() {
        let timer_position = timer.outer_position().map_err(|e| e.to_string())?;
        let timer_size = timer.outer_size().map_err(|e| e.to_string())?;
        let menu_size = menu.outer_size().map_err(|e| e.to_string())?;
        let area = timer_work_area(&timer, None)?;
        let margin = 8;
        let area_right = area.x + area.width as i32;
        let area_bottom = area.y + area.height as i32;
        let preferred_x = timer_position.x + timer_size.width as i32 - menu_size.width as i32;
        let below = timer_position.y + timer_size.height as i32 + margin;
        let above = timer_position.y - menu_size.height as i32 - margin;
        let x = preferred_x.clamp(area.x, (area_right - menu_size.width as i32).max(area.x));
        let y = if below + menu_size.height as i32 <= area_bottom { below } else { above }
            .clamp(area.y, (area_bottom - menu_size.height as i32).max(area.y));
        menu.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    }
    menu.emit("focus://popout-menu-view", view.unwrap_or_else(|| "more".into())).map_err(|e| e.to_string())?;
    menu.show().map_err(|e| e.to_string())?;
    menu.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn hide_timer_menu(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("timer-menu") {
        window.hide().map_err(|e| e.to_string())?;
    }
    if let Some(timer) = app.get_webview_window("timer") {
        timer.emit("focus://popout-menu-closed", ()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn auto_hide_tab_size(edge: &str, tab_size: &str) -> (i32, i32) {
    let vertical = edge == "left" || edge == "right";
    let (thickness, length) = match tab_size {
        "small" => (14, 46),
        "large" => (24, 76),
        _ => (18, 58),
    };
    if vertical { (thickness, length) } else { (length, thickness) }
}

fn show_without_focus(window: &tauri::WebviewWindow) -> Result<(), String> {
    // Raw ShowWindow bypasses Tao's VISIBLE flag, making a later hide a no-op.
    // Keep its state synchronized while temporarily preventing activation.
    window.set_focusable(false).map_err(|e| e.to_string())?;
    let shown = window.show().map_err(|e| e.to_string());
    let focusable = window.set_focusable(true).map_err(|e| e.to_string());
    shown.and(focusable)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TimerGeometry { positioning_supported: bool, x: i32, y: i32, width: u32, height: u32, scale: f64, visible: bool, tab_visible: bool, requested: bool, generation: u64, shortcut_active: bool, reveal_sequence: u64, menu_visible: bool, work_area: WorkArea }

#[tauri::command]
fn get_timer_geometry(app: tauri::AppHandle, monitor_id: Option<String>) -> Result<TimerGeometry, String> {
    let managed = app.state::<popout_lifecycle::PopoutLifecycle>();
    let lifecycle = popout_lifecycle::lock(&managed)?;
    let timer = app.get_webview_window("timer").ok_or("Timer unavailable")?;
    #[cfg(not(target_os = "linux"))]
    let position = timer.outer_position().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    let position = if supports_window_positioning() { timer.outer_position().map_err(|e| e.to_string())? } else { tauri::PhysicalPosition::new(0, 0) };
    let size = timer.outer_size().map_err(|e| e.to_string())?;
    Ok(TimerGeometry { positioning_supported: supports_window_positioning(), x: position.x, y: position.y, width: size.width, height: size.height,
        requested: lifecycle.requested && lifecycle.active(), generation: lifecycle.generation, shortcut_active: lifecycle.shortcut_reveal.is_some(), reveal_sequence: lifecycle.reveal_sequence,
        scale: timer.scale_factor().map_err(|e| e.to_string())?, visible: timer.is_visible().map_err(|e| e.to_string())?,
        menu_visible: app.get_webview_window("timer-menu").is_some_and(|menu| menu.is_visible().unwrap_or(false)),
        tab_visible: app.get_webview_window("timer-tab").is_some_and(|tab| tab.is_visible().unwrap_or(false)),
        work_area: timer_work_area(&timer, monitor_id.as_deref())? })
}

#[tauri::command]
fn restore_timer_bounds(app: tauri::AppHandle, x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
    let timer = app.get_webview_window("timer").ok_or("Timer unavailable")?;
    if supports_window_positioning() { timer.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?; }
    timer.set_size(tauri::PhysicalSize::new(width.max(1), height.max(1))).map_err(|e| e.to_string())?;
    ensure_timer_on_screen(&timer)
}

fn reveal_tab_position(area: &WorkArea, width: u32, height: u32, inset: i32, edge: &str, offset: f64) -> (i32, i32) {
    let normalized = if offset.is_finite() { offset.clamp(0.0, 1.0) } else { 0.0 };
    let free_x = area.width.saturating_sub(width) as i32;
    let free_y = area.height.saturating_sub(height) as i32;
    let inset_x = inset.min(free_x / 2).max(0);
    let inset_y = inset.min(free_y / 2).max(0);
    let along_x = (area.x + (normalized * area.width as f64).round() as i32 - width as i32 / 2).clamp(area.x + inset_x, area.x + free_x - inset_x);
    let along_y = (area.y + (normalized * area.height as f64).round() as i32 - height as i32 / 2).clamp(area.y + inset_y, area.y + free_y - inset_y);
    match edge {
        "left" => (area.x, along_y),
        "right" => (area.x + free_x, along_y),
        "top" => (along_x, area.y),
        _ => (along_x, area.y + free_y),
    }
}

#[tauri::command]
fn show_timer_auto_hide_tab(app: tauri::AppHandle, edge: String, offset: f64, tab_size: String, generation: u64, require_pointer_outside: Option<bool>, expected_sequence: Option<u64>) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if !supports_window_positioning() { return Ok(()); }
    let managed = app.state::<popout_lifecycle::PopoutLifecycle>();
    let mut lifecycle = popout_lifecycle::lock(&managed)?;
    if !lifecycle.allows(generation) { return Ok(()); }
    if expected_sequence.is_some_and(|sequence| sequence != lifecycle.reveal_sequence) { return Ok(()); }
    if lifecycle.shortcut_reveal.is_some() || (require_pointer_outside.unwrap_or(false) && lifecycle.pointer_inside) { return Ok(()); }
    if app.get_webview_window("timer-menu").is_some_and(|menu| menu.is_visible().unwrap_or(false)) { return Ok(()); }
    auto_hide_windows(&app, edge, offset, tab_size)?;
    lifecycle.pointer_inside = false;
    Ok(())
}

fn auto_hide_windows(app: &tauri::AppHandle, edge: String, offset: f64, tab_size: String) -> Result<(), String> {
    let timer = app.get_webview_window("timer").ok_or_else(|| "The timer window is unavailable".to_string())?;
    let tab = app.get_webview_window("timer-tab").ok_or_else(|| "The timer reveal tab is unavailable".to_string())?;
    if !timer.is_visible().map_err(|e| e.to_string())? && !tab.is_visible().map_err(|e| e.to_string())? {
        return Ok(());
    }
    let (width, height) = auto_hide_tab_size(&edge, &tab_size);
    // The real timer's current monitor is authoritative, even if a saved display
    // index has changed after a monitor was disconnected or the window moved.
    let area = timer_work_area(&timer, None)?;
    // Establish the target monitor's DPI before sizing its independent reveal tab.
    tab.set_position(tauri::PhysicalPosition::new(area.x, area.y)).map_err(|e| e.to_string())?;
    tab.set_size(tauri::LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    let size = tab.outer_size().map_err(|e| e.to_string())?;
    let inset = (10.0 * tab.scale_factor().map_err(|e| e.to_string())?).round() as i32;
    let (x, y) = reveal_tab_position(&area, size.width, size.height, inset, &edge, offset);
    let position = tauri::PhysicalPosition::new(x, y);
    #[cfg(debug_assertions)]
    eprintln!("[popout tab] edge={} physical=({}, {}) size={}x{} scale={}", edge, x, y, size.width, size.height, tab.scale_factor().unwrap_or(1.0));
    tab.set_position(position).map_err(|e| e.to_string())?;
    tab.emit("focus://auto-hide-tab-edge", edge).map_err(|e| e.to_string())?;
    show_without_focus(&tab)?;
    if let Some(menu) = app.get_webview_window("timer-menu") { menu.hide().map_err(|e| e.to_string())?; }
    timer.hide().map_err(|e| e.to_string())?;
    let _ = timer.emit("focus://popout-auto-hidden", ());
    Ok(())
}

#[tauri::command]
fn resize_timer_auto_hide_tab(app: tauri::AppHandle, edge: String, tab_size: String) -> Result<(), String> {
    let tab = app.get_webview_window("timer-tab").ok_or_else(|| "The timer reveal tab is unavailable".to_string())?;
    if !tab.is_visible().map_err(|e| e.to_string())? {
        return Ok(());
    }
    let area = timer_work_area(&tab, None)?;
    let old_position = tab.outer_position().map_err(|e| e.to_string())?;
    let old_size = tab.outer_size().map_err(|e| e.to_string())?;
    let inset = (10.0 * tab.scale_factor().map_err(|e| e.to_string())?).round() as i32;
    let old_span = if edge == "left" || edge == "right" { area.height as i32 - old_size.height as i32 - inset * 2 } else { area.width as i32 - old_size.width as i32 - inset * 2 };
    let old_value = if edge == "left" || edge == "right" { old_position.y - area.y - inset } else { old_position.x - area.x - inset };
    let offset = if old_span <= 0 { 0.0 } else { (old_value as f64 / old_span as f64).clamp(0.0, 1.0) };
    let (width, height) = auto_hide_tab_size(&edge, &tab_size);
    tab.set_size(tauri::LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    let size = tab.outer_size().map_err(|e| e.to_string())?;
    let x_span = (area.width as i32 - size.width as i32 - inset * 2).max(0);
    let y_span = (area.height as i32 - size.height as i32 - inset * 2).max(0);
    let along_x = area.x + inset + (offset * x_span as f64).round() as i32;
    let along_y = area.y + inset + (offset * y_span as f64).round() as i32;
    let position = match edge.as_str() {
        "left" => tauri::PhysicalPosition::new(area.x, along_y),
        "right" => tauri::PhysicalPosition::new(area.x + area.width as i32 - size.width as i32, along_y),
        "top" => tauri::PhysicalPosition::new(along_x, area.y),
        _ => tauri::PhysicalPosition::new(along_x, area.y + area.height as i32 - size.height as i32),
    };
    tab.set_position(position).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn request_timer_reveal(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("timer") {
        window.emit("focus://reveal-auto-hide", ()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn cancel_timer_auto_hide(app: tauri::AppHandle, generation: u64, shortcut: Option<bool>) -> Result<(), String> {
    let managed = app.state::<popout_lifecycle::PopoutLifecycle>();
    let mut lifecycle = popout_lifecycle::lock(&managed)?;
    if !lifecycle.allows(generation) { return Ok(()); }
    if let Some(tab) = app.get_webview_window("timer-tab") {
        tab.hide().map_err(|e| e.to_string())?;
    }
    if let Some(timer) = app.get_webview_window("timer") {
        ensure_timer_on_screen(&timer)?;
        show_without_focus(&timer)?;
        lifecycle.cancel_shortcut_reveal();
        if shortcut.unwrap_or(false) && !lifecycle.pointer_inside && !lifecycle.shortcut_disabled { lifecycle.shortcut_reveal = Some(lifecycle.reveal_sequence); }
        let _ = timer.emit("focus://popout-shown", ());
    }
    Ok(())
}

#[tauri::command]
fn set_timer_always_on_top(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("timer") {
        window
            .set_always_on_top(enabled)
            .map_err(|e| e.to_string())?;
    }
    if let Some(window) = app.get_webview_window("timer-menu") {
        window.set_always_on_top(enabled).map_err(|e| e.to_string())?;
    }
    if let Some(window) = app.get_webview_window("timer-tab") {
        window.set_always_on_top(enabled).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_timer_taskbar(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("timer") {
        window
            .set_skip_taskbar(!visible)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_timer_size(app: tauri::AppHandle, size: String, layout: Option<String>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("timer") {
        let (width, height) = match (layout.as_deref(), size.as_str()) {
            (Some("compact"), "small") => (280, 70),
            (Some("compact"), "large") => (380, 90),
            (Some("compact"), _) => (320, 78),
            (_, "small") => (320, 170),
            (_, "large") => (460, 230),
            _ => (380, 190),
        };
        window.set_size(tauri::LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
        ensure_timer_on_screen(&window)?;
    }
    Ok(())
}

#[tauri::command]
fn set_timer_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if !supports_window_positioning() { return Ok(()); }
    if let Some(window) = app.get_webview_window("timer") {
        window.set_position(clamped_timer_position(&window, x, y)?).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn restore_timer_floating_position(app: tauri::AppHandle, x: Option<i32>, y: Option<i32>) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if !supports_window_positioning() { return Ok(()); }
    if let Some(window) = app.get_webview_window("timer") {
        let current = window.outer_position().map_err(|e| e.to_string())?;
        let position = clamped_timer_position(&window, x.unwrap_or(current.x), y.unwrap_or(current.y))?;
        window.set_position(position).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_timer_position_unchecked(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if !supports_window_positioning() { return Ok(()); }
    if let Some(window) = app.get_webview_window("timer") {
        window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_timer_work_area(
    app: tauri::AppHandle,
    monitor_id: Option<String>,
) -> Result<WorkArea, String> {
    let window = app
        .get_webview_window("timer")
        .ok_or_else(|| "The configured timer window is unavailable".to_string())?;
    timer_work_area(&window, monitor_id.as_deref())
}

#[tauri::command]
fn focus_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_timer_popout(app: tauri::AppHandle) -> Result<(), String> {
    popout_lifecycle::close(&app)
}

#[tauri::command]
fn close_main_window(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn set_main_fullscreen(app: tauri::AppHandle, fullscreen: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_fullscreen(fullscreen)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn is_main_fullscreen(app: tauri::AppHandle) -> Result<bool, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "The main Shunhen window is unavailable".to_string())?
        .is_fullscreen()
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Webviews may invoke startup commands before the application setup callback.
    // Register this plugin with the builder so its state exists before any window loads.
    #[cfg(not(target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_autostart::Builder::new()
            // Preserve the existing Run key / autostart file across the display rename.
            .app_name("Focus")
            .build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    builder
        .manage(popout_lifecycle::PopoutLifecycle::default())
        .manage(reveal_shortcut::RevealShortcut::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                let _ = window.emit("focus://second-instance", ());
            }
        }))
        // Plugin setup runs before configured webviews are created.
        .plugin(tauri::plugin::Builder::<tauri::Wry>::new("storage")
            .setup(|app, _| storage::install(app))
            .build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            linux_desktop::install(app.handle())?;
            window_constraints::install(app.handle())?;
            display_geometry::install(app.handle())?;
            #[cfg(desktop)]
            {
                #[cfg(target_os = "linux")]
                if supports_window_positioning() {
                    // Missing X11 hotkey support must not prevent normal app use.
                    if let Err(error) = app.handle().plugin(tauri_plugin_global_shortcut::Builder::new().build()) {
                        eprintln!("Global reveal shortcuts unavailable: {error}");
                    }
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            storage::storage_request,
            supports_window_positioning,
            window_constraints::set_main_minimum_width,
            reveal_shortcut::set_reveal_shortcut,
            reveal_shortcut::reveal_shortcut_available,
            get_timer_geometry,
            restore_timer_bounds,
            update_probe::probe_update_manifest,
            open_external_url,
            popout_lifecycle::sync_popout_session,
            popout_lifecycle::prepare_timer_popout,
            popout_lifecycle::arm_shortcut_reveal,
            popout_lifecycle::cancel_shortcut_reveal,
            popout_lifecycle::reconcile_popout_preferences,
            popout_lifecycle::interact_with_shortcut_reveal,
            popout_lifecycle::expire_shortcut_reveal,
            open_timer_popout,
            open_timer_menu,
            hide_timer_menu,
            show_timer_auto_hide_tab,
            resize_timer_auto_hide_tab,
            request_timer_reveal,
            cancel_timer_auto_hide,
            set_timer_always_on_top,
            set_timer_taskbar,
            set_timer_size,
            set_timer_position,
            restore_timer_floating_position,
            set_timer_position_unchecked,
            get_timer_work_area,
            list_monitor_work_areas,
            focus_main_window,
            hide_timer_popout,
            close_main_window,
            set_main_fullscreen,
            is_main_fullscreen
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                storage::release_window(window.app_handle(), window.label());
                // Startup failure UI has no React close handler. Hidden auxiliary
                // windows must not keep an instance with no main window alive.
                if window.label() == "main" { window.app_handle().exit(0); }
            }
            if window.label() == "timer" && matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }) {
                let _ = window.emit("focus://display-geometry-changed", "timer-geometry-change");
            }
            if window.label() == "timer" || window.label() == "timer-menu" || window.label() == "timer-tab" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if window.label() != "timer-menu" {
                        let _ = popout_lifecycle::close(window.app_handle());
                    } else { let _ = window.hide(); }
                    if window.label() == "timer-menu" {
                        if let Some(timer) = window.app_handle().get_webview_window("timer") {
                            let _ = timer.emit("focus://popout-menu-closed", ());
                        }
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Shunhen")
        .run(|_app, _event| {});
}

#[cfg(test)]
mod tab_geometry_tests {
    use super::*;
    #[test]
    fn clamps_all_edges_on_negative_displays_and_resized_work_areas() {
        for (width, height) in [(1920, 1080), (1280, 720)] {
            let area = WorkArea { x: -1920, y: -1080, width, height };
            for edge in ["top", "right", "bottom", "left"] {
                for offset in [-1.0, 0.5, 2.0] {
                    let (x,y) = reveal_tab_position(&area, 90, 18, 15, edge, offset);
                    assert!(x >= area.x && x + 90 <= area.x + width as i32);
                    assert!(y >= area.y && y + 18 <= area.y + height as i32);
                    match edge {
                        "top" => assert_eq!(y, area.y),
                        "bottom" => assert_eq!(y + 18, area.y + height as i32),
                        "left" => assert_eq!(x, area.x),
                        _ => assert_eq!(x + 90, area.x + width as i32),
                    }
                }
            }
        }
    }
}
