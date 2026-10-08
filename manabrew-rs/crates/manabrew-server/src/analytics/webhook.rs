use std::time::Duration;

use reqwest::header::{HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use crate::protocol::GameFormat;

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WebhookTarget {
    pub url: String,
    pub token: String,
    pub usernames: Vec<String>,
}

pub fn parse_targets(raw: &str) -> Result<Vec<WebhookTarget>, String> {
    let targets: Vec<WebhookTarget> =
        serde_json::from_str(raw).map_err(|_| "Invalid webhook configuration JSON")?;
    if targets.len() > 16 {
        return Err("At most 16 webhook integrations are supported".into());
    }
    for target in &targets {
        let url = reqwest::Url::parse(&target.url).map_err(|_| "Invalid webhook URL")?;
        let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        if (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
        {
            return Err("Webhook URLs require HTTPS without credentials or fragments; HTTP is allowed only on loopback".into());
        }
        if target.token.len() < 32
            || target.token.len() > 256
            || !target
                .token
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        {
            return Err(
                "Webhook tokens must contain 32–256 ASCII letters, digits, hyphens or underscores"
                    .into(),
            );
        }
        if target.usernames.is_empty()
            || target.usernames.len() > 100
            || target
                .usernames
                .iter()
                .any(|name| name.trim().is_empty() || name.len() > 128)
        {
            return Err("Each webhook needs an allowlist of 1–100 nonempty usernames".into());
        }
    }
    Ok(targets)
}

#[derive(Clone, Serialize)]
pub struct GameResult {
    pub schema_version: u8,
    pub event: &'static str,
    pub game_id: String,
    pub format: GameFormat,
    pub winner: Option<String>,
    pub players: Vec<ResultPlayer>,
}

#[derive(Clone, Serialize)]
pub struct ResultPlayer {
    pub username: String,
}

pub struct WebhookHandle {
    targets: Vec<(Vec<String>, mpsc::Sender<GameResult>)>,
}

impl WebhookHandle {
    pub fn spawn(targets: Vec<WebhookTarget>) -> Self {
        let mut senders = Vec::new();
        for (integration, target) in targets.into_iter().enumerate() {
            let (tx, mut rx) = mpsc::channel::<GameResult>(128);
            let usernames = target.usernames;
            tokio::spawn(async move {
                let client = match reqwest::Client::builder()
                    .timeout(Duration::from_secs(5))
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                {
                    Ok(client) => client,
                    Err(_) => {
                        tracing::error!(integration, "Webhook HTTP client failed to initialize");
                        return;
                    }
                };
                let mut authorization =
                    HeaderValue::from_str(&format!("Bearer {}", target.token)).unwrap();
                authorization.set_sensitive(true);
                while let Some(result) = rx.recv().await {
                    let mut delivered = false;
                    for attempt in 0..3 {
                        let response = client
                            .post(&target.url)
                            .header(AUTHORIZATION, authorization.clone())
                            .header("Idempotency-Key", &result.game_id)
                            .json(&result)
                            .send()
                            .await;
                        match response {
                            Ok(response) if response.status().is_success() => {
                                delivered = true;
                                break;
                            }
                            Ok(response)
                                if !response.status().is_server_error()
                                    && response.status()
                                        != reqwest::StatusCode::TOO_MANY_REQUESTS =>
                            {
                                break
                            }
                            _ => {}
                        }
                        if attempt < 2 {
                            tokio::time::sleep(Duration::from_secs(1 << attempt)).await;
                        }
                    }
                    if !delivered {
                        tracing::warn!(integration, game_id = %result.game_id, "Game-result webhook delivery failed");
                    }
                }
            });
            senders.push((usernames, tx));
        }
        Self { targets: senders }
    }

    pub fn emit(&self, result: GameResult) {
        for (integration, (usernames, tx)) in self.targets.iter().enumerate() {
            if result
                .players
                .iter()
                .any(|player| usernames.contains(&player.username))
                && tx.try_send(result.clone()).is_err()
            {
                tracing::warn!(integration, game_id = %result.game_id, "Game-result webhook queue unavailable");
            }
        }
    }
}
