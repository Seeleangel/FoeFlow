use base64::Engine;
use imap_proto::{parse_response, AttributeValue, Response};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::TcpStream;
use native_tls::TlsStream;

#[derive(Debug, Serialize, Deserialize)]
pub struct ImapConfig {
    pub email: String,
    pub auth_code: String,
    pub server: String,
    pub port: u16,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EmailMessage {
    pub uid: u32,
    pub subject: String,
    pub from: String,
    pub date: String,
}

#[tauri::command]
pub async fn fetch_imap_emails(
    config: ImapConfig,
    last_uid: Option<u32>,
) -> Result<Vec<EmailMessage>, String> {
    tokio::task::spawn_blocking(move || fetch_emails_sync(config, last_uid))
        .await
        .map_err(|e| format!("Task join failed: {}", e))?
}

fn connect_and_select(config: &ImapConfig) -> Result<TlsStream<TcpStream>, String> {
    let tcp = TcpStream::connect((config.server.as_str(), config.port))
        .map_err(|e| format!("TCP connect failed: {}", e))?;
    tcp.set_read_timeout(Some(std::time::Duration::from_secs(60)))
        .map_err(|e| format!("Set read timeout failed: {}", e))?;
    tcp.set_write_timeout(Some(std::time::Duration::from_secs(10)))
        .map_err(|e| format!("Set write timeout failed: {}", e))?;

    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(|e| format!("TLS build failed: {}", e))?;

    let mut stream = tls
        .connect(config.server.as_str(), tcp)
        .map_err(|e| format!("TLS handshake failed: {}", e))?;

    // Read greeting
    let greeting = readline(&mut stream)?;
    if !greeting.starts_with("* OK") {
        return Err(format!("Bad greeting: {}", greeting));
    }
    log::info!("[imap] Greeting: {}", greeting);

    // Login
    let login_tag = "a1".to_string();
    write_command(&mut stream, &login_tag, &format!("LOGIN {} {}", config.email, config.auth_code))?;
    read_response_until_tag(&mut stream, &login_tag)?;
    log::info!("[imap] Login OK");

    // Send ID command (163 requires ID after LOGIN, otherwise SELECT gets "Unsafe Login")
    let id_tag = "a2".to_string();
    write_command(&mut stream, &id_tag, &format!("ID (\"name\" \"{}\" \"contact\" \"{}\" \"version\" \"1.0.0\" \"vendor\" \"foe-app\")", config.email, config.email))?;
    match read_response_until_tag(&mut stream, &id_tag) {
        Ok(_) => log::info!("[imap] ID command OK"),
        Err(e) => {
            log::warn!("[imap] ID command failed (non-fatal): {}", e);
        }
    }

    // Select INBOX
    let select_tag = "a3".to_string();
    write_command(&mut stream, &select_tag, "SELECT INBOX")?;
    read_response_until_tag(&mut stream, &select_tag)?;
    log::info!("[imap] SELECT INBOX OK");

    Ok(stream)
}

fn fetch_emails_sync(config: ImapConfig, last_uid: Option<u32>) -> Result<Vec<EmailMessage>, String> {
    log::info!("[imap] Connecting to {}:{}", config.server, config.port);

    let mut stream = connect_and_select(&config)?;

    // UID FETCH
    let uid_set = match last_uid {
        Some(last) => format!("{}:*", last + 1),
        None => "1:*".to_string(),
    };
    let fetch_tag = "a4".to_string();
    write_command(&mut stream, &fetch_tag, &format!("UID FETCH {} (UID ENVELOPE)", uid_set))?;
    log::info!("[imap] Fetching uid range: {}", uid_set);

    let fetch_responses = read_fetch_responses(&mut stream, &fetch_tag)?;
    log::info!("[imap] Got {} fetch responses", fetch_responses.len());

    let mut emails = Vec::new();

    for bytes in &fetch_responses {
        match parse_response(bytes) {
            Ok((_, Response::Fetch(_, attrs))) => {
                let mut uid = None;
                let mut envelope = None;
                for attr in attrs {
                    match attr {
                        AttributeValue::Uid(u) => uid = Some(u),
                        AttributeValue::Envelope(env) => envelope = Some(env),
                        _ => {}
                    }
                }

                if let (Some(uid), Some(env)) = (uid, envelope) {
                    if let Some(last) = last_uid {
                        if uid <= last {
                            continue;
                        }
                    }

                    let subject = env
                        .subject
                        .map(|s| decode_bytes(s))
                        .unwrap_or_else(|| "（无主题）".to_string());

                    let from = if let Some(addrs) = env.from.as_ref() {
                        if let Some(addr) = addrs.get(0) {
                            format_address(addr)
                        } else {
                            "未知发件人".to_string()
                        }
                    } else {
                        "未知发件人".to_string()
                    };

                    let date = env
                        .date
                        .map(|d| String::from_utf8_lossy(d).to_string())
                        .unwrap_or_default();

                    emails.push(EmailMessage { uid, subject, from, date });
                }
            }
            Ok((_, other)) => {
                log::debug!("[imap] Non-fetch response during FETCH parsing: {:?}", other);
            }
            Err(e) => {
                log::warn!("[imap] Failed to parse FETCH response: {:?} | bytes: {}", e, String::from_utf8_lossy(bytes));
            }
        }
    }

    // Logout (best effort)
    let logout_tag = "a5".to_string();
    let _ = write_command(&mut stream, &logout_tag, "LOGOUT");
    let _ = read_response_until_tag(&mut stream, &logout_tag);

    log::info!("[imap] Returning {} new emails", emails.len());
    Ok(emails)
}

fn write_command(stream: &mut TlsStream<TcpStream>, tag: &str, cmd: &str) -> Result<(), String> {
    let full = format!("{} {}\r\n", tag, cmd);
    stream.write_all(full.as_bytes()).map_err(|e| format!("Write failed: {}", e))?;
    stream.flush().map_err(|e| format!("Flush failed: {}", e))?;
    Ok(())
}

fn readline(stream: &mut TlsStream<TcpStream>) -> Result<String, String> {
    let mut line = Vec::new();
    let mut prev = 0u8;
    loop {
        let mut byte = [0u8; 1];
        stream.read_exact(&mut byte).map_err(|e| format!("Read failed: {}", e))?;
        line.push(byte[0]);
        if prev == b'\r' && byte[0] == b'\n' {
            line.pop(); // \n
            line.pop(); // \r
            break;
        }
        prev = byte[0];
    }
    Ok(String::from_utf8_lossy(&line).to_string())
}

fn read_response_until_tag(stream: &mut TlsStream<TcpStream>, tag: &str) -> Result<Vec<String>, String> {
    let mut lines = Vec::new();
    loop {
        let line = readline(stream)?;
        if let Some(rest) = line.strip_prefix(&format!("{} ", tag)) {
            if !rest.starts_with("OK") && !rest.starts_with("ok") {
                return Err(format!("Command failed: {}", line));
            }
            break;
        }
        lines.push(line);
    }
    Ok(lines)
}

fn read_fetch_responses(stream: &mut TlsStream<TcpStream>, tag: &str) -> Result<Vec<Vec<u8>>, String> {
    let mut responses: Vec<Vec<u8>> = Vec::new();
    let mut current: Vec<u8> = Vec::new();

    loop {
        let line = readline(stream)?;
        log::info!("[imap] read_fetch_responses line: {:?}", line);

        // Check for tagged response
        if let Some(rest) = line.strip_prefix(&format!("{} ", tag)) {
            if !rest.starts_with("OK") && !rest.starts_with("ok") {
                return Err(format!("FETCH failed: {}", line));
            }
            log::info!("[imap] read_fetch_responses got tagged OK");
            break;
        }

        current.extend_from_slice(line.as_bytes());
        current.extend_from_slice(b"\r\n");
        log::info!("[imap] read_fetch_responses current len: {}", current.len());

        match parse_response(&current) {
            Ok((_, Response::Fetch(_, _))) => {
                log::info!("[imap] read_fetch_responses parse OK (Fetch), pushing response");
                responses.push(current.clone());
                current.clear();
            }
            Ok((_, other)) => {
                log::info!("[imap] read_fetch_responses parse OK (other): {:?}", other);
                current.clear();
            }
            Err(e) => {
                log::info!("[imap] read_fetch_responses parse ERR: {:?}", e);
                if current.len() > 1024 * 1024 {
                    log::warn!("[imap] Dropping oversized unparseable response");
                    current.clear();
                }
            }
        }
    }

    Ok(responses)
}

fn format_address(addr: &imap_proto::types::Address) -> String {
    let name = addr.name.map(|n| decode_bytes(n)).unwrap_or_default();
    let mailbox = addr.mailbox.map(|m| String::from_utf8_lossy(m).to_string()).unwrap_or_default();
    let host = addr.host.map(|h| String::from_utf8_lossy(h).to_string()).unwrap_or_default();
    if !name.is_empty() {
        format!("{} <{}@{}>", name, mailbox, host)
    } else if !mailbox.is_empty() && !host.is_empty() {
        format!("{}@{}", mailbox, host)
    } else {
        mailbox
    }
}

fn decode_bytes(bytes: &[u8]) -> String {
    let raw = String::from_utf8_lossy(bytes);
    decode_mime_words(&raw)
}

fn decode_mime_words(input: &str) -> String {
    let mut result = String::new();
    let mut i = 0usize;
    let chars: Vec<char> = input.chars().collect();

    while i < chars.len() {
        if chars[i] == '=' && i + 1 < chars.len() && chars[i + 1] == '?' {
            i += 2; // skip "=?"

            // charset
            let mut charset = String::new();
            while i < chars.len() && chars[i] != '?' {
                charset.push(chars[i]);
                i += 1;
            }
            if i >= chars.len() { break; }
            i += 1; // skip "?"

            // encoding
            let mut encoding = String::new();
            while i < chars.len() && chars[i] != '?' {
                encoding.push(chars[i]);
                i += 1;
            }
            if i >= chars.len() { break; }
            i += 1; // skip "?"

            // encoded text
            let mut encoded = String::new();
            while i < chars.len() {
                if chars[i] == '?' && i + 1 < chars.len() && chars[i + 1] == '=' {
                    i += 2; // skip "?="
                    break;
                }
                encoded.push(chars[i]);
                i += 1;
            }

            if encoding.eq_ignore_ascii_case("B") {
                if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&encoded) {
                    result.push_str(&String::from_utf8_lossy(&bytes));
                }
            } else if encoding.eq_ignore_ascii_case("Q") {
                if let Ok(bytes) = decode_quoted_printable(&encoded) {
                    result.push_str(&String::from_utf8_lossy(&bytes));
                }
            }
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }

    if result.is_empty() {
        input.trim().to_string()
    } else {
        result.trim().to_string()
    }
}

fn decode_quoted_printable(input: &str) -> Result<Vec<u8>, String> {
    let mut result = Vec::new();
    let mut i = 0usize;
    let chars: Vec<char> = input.chars().collect();

    while i < chars.len() {
        if chars[i] == '=' {
            if i + 2 < chars.len() {
                let hex = format!("{}{}", chars[i + 1], chars[i + 2]);
                if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                    result.push(byte);
                    i += 3;
                    continue;
                }
            }
            if i + 1 < chars.len() && chars[i + 1] == '\n' {
                i += 2; // soft line break
                continue;
            }
        } else if chars[i] == '_' {
            result.push(b' ');
            i += 1;
            continue;
        }
        result.push(chars[i] as u8);
        i += 1;
    }

    Ok(result)
}
