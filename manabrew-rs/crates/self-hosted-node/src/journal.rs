#![cfg_attr(not(forge_backend), allow(dead_code))]

use manabrew_relay_protocol::{ClientMessage, DecisionJournalRequest};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};

pub(crate) fn enabled() -> bool {
    std::env::var("SELF_HOSTED_NODE_DECISION_JOURNAL")
        .is_ok_and(|value| value == "1" || value.eq_ignore_ascii_case("true"))
}

static ARTIFACTS: OnceLock<(String, String)> = OnceLock::new();

pub(crate) fn init_artifacts(engine: &Path, assets: &Path) -> Result<(), String> {
    if ARTIFACTS.get().is_some() {
        return Ok(());
    }
    let engine = hash_file(engine).map_err(|e| format!("cannot identify journal engine: {e}"))?;
    let mut paths = Vec::new();
    collect_assets(assets, assets, &mut paths)
        .map_err(|e| format!("cannot identify journal assets: {e}"))?;
    paths.sort();
    if paths.is_empty() {
        return Err("journal assets directory is empty".into());
    }
    let mut digest = Sha256::new();
    digest.update(b"manabrew-assets-v1\0");
    for path in paths {
        let name = path
            .to_str()
            .ok_or("journal asset path is not UTF-8")?
            .replace('\\', "/");
        digest.update((name.len() as u64).to_be_bytes());
        digest.update(name.as_bytes());
        digest.update(hash_file(&assets.join(&path)).map_err(|e| e.to_string())?);
    }
    let _ = ARTIFACTS.set((engine, format!("{:x}", digest.finalize())));
    Ok(())
}

fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn collect_assets(
    root: &Path,
    directory: &Path,
    paths: &mut Vec<std::path::PathBuf>,
) -> std::io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir() {
            collect_assets(root, &entry.path(), paths)?;
        } else if kind.is_file() {
            paths.push(entry.path().strip_prefix(root).unwrap().to_owned());
        } else {
            return Err(std::io::Error::other(
                "journal assets must be regular files",
            ));
        }
    }
    Ok(())
}

struct Pending {
    id: String,
    request: DecisionJournalRequest,
    reply: mpsc::Sender<Result<String, String>>,
}

#[derive(Default)]
struct State {
    generation: u64,
    pending: Option<Pending>,
}

pub(crate) struct JournalDelivery {
    game_id: String,
    official_key: String,
    state: Mutex<State>,
}

#[derive(Deserialize)]
struct Position {
    epoch: i64,
    sequence: i64,
    unavailable_reason: Option<String>,
}

enum RpcError {
    Retry,
    Failed(String),
}

impl JournalDelivery {
    pub(crate) fn new(game_id: String, official_key: String) -> Self {
        Self {
            game_id,
            official_key,
            state: Mutex::new(State::default()),
        }
    }

    pub(crate) fn reconnect(&self) {
        let mut state = self.state.lock().unwrap();
        state.generation += 1;
        state.pending = None;
    }

    pub(crate) fn request_after(&self, previous: Option<&str>) -> Option<(String, ClientMessage)> {
        let state = self.state.lock().unwrap();
        let pending = state.pending.as_ref()?;
        if previous == Some(pending.id.as_str()) {
            return None;
        }
        Some((
            pending.id.clone(),
            ClientMessage::DecisionJournal {
                game_id: self.game_id.clone(),
                request_id: pending.id.clone(),
                official_key: self.official_key.clone(),
                request: pending.request.clone(),
            },
        ))
    }

    pub(crate) fn complete(&self, request_id: &str, result: Result<String, String>) {
        let mut state = self.state.lock().unwrap();
        if state
            .pending
            .as_ref()
            .is_some_and(|pending| pending.id == request_id)
        {
            let _ = state.pending.take().unwrap().reply.send(result);
        }
    }

    fn rpc(
        &self,
        generation: u64,
        request: DecisionJournalRequest,
        cancel: &AtomicBool,
    ) -> Result<Position, RpcError> {
        let (tx, rx) = mpsc::channel();
        let id = uuid::Uuid::new_v4().to_string();
        {
            let mut state = self.state.lock().unwrap();
            if state.generation != generation {
                return Err(RpcError::Retry);
            }
            state.pending = Some(Pending {
                id: id.clone(),
                request,
                reply: tx,
            });
        }
        let started = Instant::now();
        let result = loop {
            if cancel.load(Ordering::Relaxed) {
                break Err(RpcError::Failed("journal delivery cancelled".into()));
            }
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(raw)) => {
                    break serde_json::from_str::<Position>(&raw)
                        .map_err(|_| RpcError::Failed("invalid journal receipt".into()))
                        .and_then(|position| {
                            if position.unavailable_reason.is_some()
                                || position.epoch < 1
                                || position.sequence < 0
                            {
                                Err(RpcError::Failed("relay journal is unavailable".into()))
                            } else {
                                Ok(position)
                            }
                        })
                }
                Ok(Err(error)) if error.ends_with("busy; retry") => break Err(RpcError::Retry),
                Ok(Err(error)) => {
                    break Err(RpcError::Failed(format!(
                        "journal delivery rejected: {error}"
                    )))
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break Err(RpcError::Retry),
                Err(mpsc::RecvTimeoutError::Timeout)
                    if started.elapsed() >= Duration::from_secs(5) =>
                {
                    break Err(RpcError::Retry)
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        };
        let mut state = self.state.lock().unwrap();
        if state
            .pending
            .as_ref()
            .is_some_and(|pending| pending.id == id)
        {
            state.pending = None;
        }
        result
    }
}

pub(crate) struct JournalWriter {
    delivery: std::sync::Arc<JournalDelivery>,
    manifest: String,
    epoch: Option<(u64, i64)>,
}

impl JournalWriter {
    pub(crate) fn new(
        delivery: std::sync::Arc<JournalDelivery>,
        start_request: &str,
    ) -> Result<Self, String> {
        let (engine, assets) = ARTIFACTS
            .get()
            .ok_or("journal artifacts were not initialized")?;
        Ok(Self {
            delivery,
            manifest: json!({"engine_sha256": engine, "assets_sha256": assets, "start_request": start_request}).to_string(),
            epoch: None,
        })
    }

    pub(crate) fn commit(&mut self, batch: String, cancel: &AtomicBool) -> Result<i64, String> {
        let parsed: serde_json::Value = serde_json::from_str(&batch).map_err(|e| e.to_string())?;
        if parsed.get("commitBarrier").and_then(|v| v.as_bool()) != Some(true) {
            return Err("engine does not confirm the journal commit barrier".into());
        }
        let through = parsed
            .get("nextSequence")
            .and_then(|v| v.as_i64())
            .filter(|n| *n > 0)
            .ok_or("invalid engine journal sequence")?
            - 1;
        let started = Instant::now();
        loop {
            let generation = self.delivery.state.lock().unwrap().generation;
            let result = (|| {
                let epoch = match self.epoch.filter(|(g, _)| *g == generation) {
                    Some((_, epoch)) => epoch,
                    None => {
                        let position = self.delivery.rpc(
                            generation,
                            DecisionJournalRequest::Open {
                                manifest: self.manifest.clone(),
                            },
                            cancel,
                        )?;
                        self.epoch = Some((generation, position.epoch));
                        position.epoch
                    }
                };
                let position = self.delivery.rpc(
                    generation,
                    DecisionJournalRequest::Append {
                        epoch,
                        batch: batch.clone(),
                    },
                    cancel,
                )?;
                if position.epoch != epoch || position.sequence != through {
                    return Err(RpcError::Failed(
                        "journal receipt does not match submitted prefix".into(),
                    ));
                }
                Ok(position.sequence)
            })();
            match result {
                Ok(sequence) => {
                    crate::metrics::record_journal_commit(through == 0, started.elapsed());
                    return Ok(sequence);
                }
                Err(RpcError::Failed(error)) => return Err(error),
                Err(RpcError::Retry) => {
                    crate::metrics::record_journal_retry();
                    self.epoch = None;
                    if started.elapsed() >= Duration::from_secs(60) {
                        return Err("journal delivery timed out".into());
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            }
        }
    }
}
