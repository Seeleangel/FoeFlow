mod db;
mod http;
mod image_compress;
mod imap;
mod license;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      http::invoke_http_request,
      http::download_image_to_file,
      http::download_image_as_base64,
      image_compress::compress_images,
      image_compress::pick_output_directory,
      imap::fetch_imap_emails,
      license::verify_license,
      license::check_activation,
      license::clear_license,
      license::claim_license_request,
      license::claim_license_code
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
