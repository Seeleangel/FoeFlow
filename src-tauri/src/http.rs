use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

#[tauri::command]
pub async fn invoke_http_request(
    url: String,
    method: String,
    headers: serde_json::Value,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    log::info!("[invoke_http_request] Received request: url={}, method={}", url, method);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(130))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let mut req = match method.as_str() {
        "POST" => client.post(&url),
        "GET" => client.get(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        _ => return Err(format!("Unsupported method: {}", method)),
    };

    // Parse headers from JSON value
    let mut has_origin = false;
    if let Some(headers_obj) = headers.as_object() {
        for (key, value) in headers_obj {
            if let Some(value_str) = value.as_str() {
                if key.eq_ignore_ascii_case("origin") {
                    has_origin = true;
                }
                req = req.header(key, value_str);
            }
        }
    }

    // Auto-add Origin header if missing (some APIs require it)
    if !has_origin {
        if let Ok(parsed) = url.parse::<reqwest::Url>() {
            let origin = format!("{}://{}", parsed.scheme(), parsed.host_str().unwrap_or(""));
            req = req.header("Origin", origin);
        }
    }

    if let Some(body) = body {
        req = req.body(body);
    }

    let response = req.send().await.map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

    log::info!("[invoke_http_request] Response: status={}", status);
    Ok(HttpResponse { status, body })
}

/// Download an image from URL and save to local file.
/// Bypasses browser CORS / tracking prevention restrictions.
#[tauri::command]
pub async fn download_image_to_file(url: String, file_path: String) -> Result<String, String> {
    log::info!(
        "[download_image_to_file] Downloading from {} to {}",
        url,
        file_path
    );
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Download failed with status: {}", status));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // Ensure parent directory exists
    if let Some(parent) = Path::new(&file_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    std::fs::write(&file_path, bytes)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    log::info!("[download_image_to_file] Saved to {}", file_path);
    Ok(file_path)
}

/// Download an image from URL and return as base64 data URL.
/// Bypasses browser CORS / tracking prevention restrictions.
/// Returns "data:image/png;base64,..." directly usable in <img src="...">.
#[tauri::command]
pub async fn download_image_as_base64(url: String) -> Result<String, String> {
    log::info!("[download_image_as_base64] Downloading from {}", url);
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Download failed with status: {}", status));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let base64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    let data_url = format!("data:{};base64,{}", content_type, base64);

    log::info!("[download_image_as_base64] Downloaded {} bytes", bytes.len());
    Ok(data_url)
}
