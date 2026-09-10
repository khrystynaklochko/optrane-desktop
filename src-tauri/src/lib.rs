use tauri::{Emitter, Manager};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

const CREDENTIAL_SERVICE: &str = "com.optrane.command.auth";

fn credential_entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
fn credential_get(key: String) -> Result<Option<String>, String> {
    match credential_entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn credential_set(key: String, value: String) -> Result<(), String> {
    credential_entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn credential_delete(key: String) -> Result<(), String> {
    match credential_entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![credential_get, credential_set, credential_delete])
        .setup(|app| {
            let new_production = MenuItemBuilder::with_id("new-production", "New Production")
                .accelerator("CmdOrCtrl+N").build(app)?;
            let upload_revision = MenuItemBuilder::with_id("upload-revision", "Upload Revision")
                .accelerator("CmdOrCtrl+O").build(app)?;
            let reset_demo = MenuItemBuilder::with_id("reset-demo", "Reset Demo").build(app)?;
            let control = MenuItemBuilder::with_id("control", "Control Room").accelerator("CmdOrCtrl+1").build(app)?;
            let impact = MenuItemBuilder::with_id("impact", "Impact").accelerator("CmdOrCtrl+2").build(app)?;
            let recovery = MenuItemBuilder::with_id("recovery", "Recovery").accelerator("CmdOrCtrl+3").build(app)?;
            let agents = MenuItemBuilder::with_id("agents", "Agent Fleet").accelerator("CmdOrCtrl+4").build(app)?;
            let register_agent = MenuItemBuilder::with_id("agent-register", "Register Agent").build(app)?;
            let audit = MenuItemBuilder::with_id("audit", "Audit Trail").build(app)?;
            let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
            let about = MenuItemBuilder::with_id("about", "About OPTRANE").build(app)?;

            let file = SubmenuBuilder::new(app, "File")
                .item(&new_production).item(&upload_revision).separator().item(&reset_demo).build()?;
            let view = SubmenuBuilder::new(app, "View")
                .item(&control).item(&impact).item(&recovery).item(&agents).item(&audit).build()?;
            let agent = SubmenuBuilder::new(app, "Agent")
                .item(&register_agent).build()?;
            let help = SubmenuBuilder::new(app, "OPTRANE")
                .item(&settings).separator().item(&about).build()?;
            let menu = MenuBuilder::new(app).item(&file).item(&view).item(&agent).item(&help).build()?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == "about" {
                let _ = app.emit("optrane-menu", "settings");
            } else {
                let _ = app.emit("optrane-menu", id);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running OPTRANE");
}
