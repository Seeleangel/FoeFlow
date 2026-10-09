use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::System;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LicenseInfo {
    pub code: String,
    pub fingerprint: String,
    pub token: String,
    pub expires_at: i64,
}

#[derive(Debug, Serialize)]
pub struct ActivationStatus {
    pub active: bool,
    pub expired: bool,
    pub code: Option<String>,
    pub fingerprint: Option<String>,
    pub token: Option<String>,
    pub expires_at: Option<i64>,
}

pub fn generate_machine_fingerprint() -> String {
    let mut sys = System::new_all();
    sys.refresh_all();
    let cpu = sys.cpus().first().map(|c| c.brand().to_string()).unwrap_or_default();
    let hostname = whoami::hostname();
    let username = whoami::username();

    let raw = format!("{}|{}|{}", cpu, hostname, username);
    let hash = Sha256::digest(raw);
    hex::encode(&hash[..8])
}

pub fn now_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

use tauri::{command, AppHandle, Manager};
use std::path::PathBuf;

fn license_server_url() -> &'static str {
    option_env!("LICENSE_SERVER_URL").unwrap_or("http://127.0.0.1:3000")
}

fn license_file_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("license.json")
}

async fn load_cached_license(app: &AppHandle) -> Option<LicenseInfo> {
    let path = license_file_path(app);
    if !path.exists() {
        return None;
    }
    let content = tokio::fs::read_to_string(path).await.ok()?;
    serde_json::from_str(&content).ok()
}

async fn save_cached_license(app: &AppHandle, info: &LicenseInfo) -> Result<(), String> {
    let path = license_file_path(app);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string(info).map_err(|e| e.to_string())?;
    tokio::fs::write(path, content).await.map_err(|e| e.to_string())
}

#[command]
pub async fn verify_license(app: AppHandle, code: String) -> Result<LicenseInfo, String> {
    let fingerprint = generate_machine_fingerprint();

    let client = reqwest::Client::new();
    let res = client
        .post(format!("{}/api/v1/activate", license_server_url()))
        .json(&serde_json::json!({
            "code": code,
            "fingerprint": fingerprint,
        }))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    if !res.status().is_success() {
        let body: serde_json::Value = res.json().await.unwrap_or_default();
        let err = body["error"].as_str().unwrap_or("UNKNOWN_ERROR");
        let msg = match err {
            "INVALID_CODE" => "校验码无效",
            "REVOKED_CODE" => "该校验码已被禁用",
            "ALREADY_BOUND" => "该校验码已在其他设备上使用",
            _ => "验证失败，请稍后重试",
        };
        return Err(msg.to_string());
    }

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let token = body["token"].as_str().ok_or("Invalid response")?.to_string();
    let expires_at = body["expires_at"].as_i64().unwrap_or(0);

    let info = LicenseInfo {
        code: code.clone(),
        fingerprint: fingerprint.clone(),
        token,
        expires_at,
    };

    save_cached_license(&app, &info).await?;
    Ok(info)
}

#[command]
pub async fn check_activation(app: AppHandle) -> Result<ActivationStatus, String> {
    let cached = load_cached_license(&app).await;

    if let Some(info) = &cached {
        let now = now_timestamp();
        if info.expires_at > now {
            return Ok(ActivationStatus {
                active: true,
                expired: false,
                code: Some(info.code.clone()),
                fingerprint: Some(info.fingerprint.clone()),
                token: Some(info.token.clone()),
                expires_at: Some(info.expires_at),
            });
        }

        // Expired, try to refresh
        let client = reqwest::Client::new();
        let res = client
            .post(format!("{}/api/v1/verify", license_server_url()))
            .json(&serde_json::json!({
                "code": info.code,
                "fingerprint": info.fingerprint,
                "token": info.token,
            }))
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await;

        if let Ok(res) = res {
            if res.status().is_success() {
                let body: serde_json::Value = res.json().await.unwrap_or_default();
                let new_token = body["token"].as_str().unwrap_or("").to_string();
                let new_expires = body["expires_at"].as_i64().unwrap_or(0);

                let updated = LicenseInfo {
                    token: new_token,
                    expires_at: new_expires,
                    ..info.clone()
                };
                let _ = save_cached_license(&app, &updated).await;

                return Ok(ActivationStatus {
                    active: true,
                    expired: false,
                    code: Some(updated.code.clone()),
                    fingerprint: Some(updated.fingerprint.clone()),
                    token: Some(updated.token.clone()),
                    expires_at: Some(new_expires),
                });
            }
        }

        return Ok(ActivationStatus {
            active: false,
            expired: true,
            code: Some(info.code.clone()),
            fingerprint: Some(info.fingerprint.clone()),
            token: Some(info.token.clone()),
            expires_at: Some(info.expires_at),
        });
    }

    Ok(ActivationStatus {
        active: false,
        expired: false,
        code: None,
        fingerprint: None,
        token: None,
        expires_at: None,
    })
}

#[command]
pub async fn clear_license(app: AppHandle) -> Result<(), String> {
    let path = license_file_path(&app);
    if path.exists() {
        tokio::fs::remove_file(path).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClaimRequestResponse {
    pub token: String,
    pub status: String,
    pub code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClaimCodeResponse {
    pub status: String,
    pub code: Option<String>,
}

#[command]
pub async fn claim_license_request() -> Result<ClaimRequestResponse, String> {
    let fingerprint = generate_machine_fingerprint();

    let client = reqwest::Client::new();
    let res = client
        .post(format!("{}/api/v1/claim-request", license_server_url()))
        .json(&serde_json::json!({
            "deviceFingerprint": fingerprint,
        }))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    if !res.status().is_success() {
        let body: serde_json::Value = res.json().await.unwrap_or_default();
        let err = body["error"].as_str().unwrap_or("UNKNOWN_ERROR");
        let msg = match err {
            "MISSING_PARAMS" => "请求参数错误",
            _ => "请求失败，请稍后重试",
        };
        return Err(msg.to_string());
    }

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let token = body["token"].as_str().ok_or("Invalid response")?.to_string();
    let status = body["status"].as_str().ok_or("Invalid response")?.to_string();
    let code = body["code"].as_str().map(|s| s.to_string());

    Ok(ClaimRequestResponse { token, status, code })
}

#[command]
pub async fn claim_license_code(token: String) -> Result<ClaimCodeResponse, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/api/v1/claim-code?token={}", license_server_url(), token))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    if !res.status().is_success() {
        let body: serde_json::Value = res.json().await.unwrap_or_default();
        let err = body["error"].as_str().unwrap_or("UNKNOWN_ERROR");
        let msg = match err {
            "NOT_FOUND" => "请求未找到，请重新获取",
            "MISSING_PARAMS" => "请求参数错误",
            _ => "查询失败，请稍后重试",
        };
        return Err(msg.to_string());
    }

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let status = body["status"].as_str().ok_or("Invalid response")?.to_string();
    let code = body["code"].as_str().map(|s| s.to_string());

    Ok(ClaimCodeResponse { status, code })
}
