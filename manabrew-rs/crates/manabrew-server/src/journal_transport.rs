use crate::journal::{JournalManifest, JournalStore};
use crate::protocol::{DecisionJournalRequest, RoomStatus, ServerMessage};
use crate::state::ServerState;
use dashmap::try_result::TryResult;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tokio::sync::Semaphore;

pub struct JournalService {
    store: Mutex<JournalStore>,
    capacity: Arc<Semaphore>,
    instance: String,
}

impl JournalService {
    pub fn open(path: &str) -> Result<Self, String> {
        Ok(Self {
            store: Mutex::new(JournalStore::open(Path::new(path))?),
            capacity: Arc::new(Semaphore::new(8)),
            instance: uuid::Uuid::new_v4().to_string(),
        })
    }
}

pub async fn handle(
    state: Arc<ServerState>,
    player_id: String,
    generation: u64,
    game_id: String,
    request_id: String,
    official_key: String,
    request: DecisionJournalRequest,
) -> ServerMessage {
    let result = execute(
        state,
        player_id,
        generation,
        game_id.clone(),
        &request_id,
        official_key,
        request,
    )
    .await;
    ServerMessage::DecisionJournalResult {
        game_id,
        request_id,
        result,
    }
}

async fn execute(
    state: Arc<ServerState>,
    player_id: String,
    generation: u64,
    game_id: String,
    request_id: &str,
    official_key: String,
    request: DecisionJournalRequest,
) -> Result<String, String> {
    if state.official_key.as_deref() != Some(official_key.as_str()) {
        return Err("journal access denied".into());
    }
    if request_id.is_empty() || request_id.len() > 128 || game_id.len() > 128 {
        return Err("invalid journal request identity".into());
    }
    match &request {
        DecisionJournalRequest::Open { manifest } if manifest.len() > 9 * 1024 * 1024 => {
            return Err("journal manifest exceeds limit".into())
        }
        DecisionJournalRequest::Append { batch, .. } if batch.len() > 9 * 1024 * 1024 => {
            return Err("journal batch exceeds limit".into())
        }
        _ => {}
    }
    let service = state.journal.clone().ok_or("journal storage is disabled")?;
    let permit = service
        .capacity
        .clone()
        .try_acquire_owned()
        .map_err(|_| "journal storage is busy; retry")?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let mut store = service
            .store
            .lock()
            .map_err(|_| "journal store unavailable")?;
        let room_id = state
            .players
            .get(&player_id)
            .and_then(|player| player.room_id.clone())
            .ok_or("journal access denied")?;
        let room = state.rooms.get(&room_id).ok_or("journal access denied")?;
        // Room mutations can lock players; never wait on that map while holding a room guard.
        let player = match state.players.try_get(&player_id) {
            TryResult::Present(player) => player,
            TryResult::Absent => return Err("journal access denied".into()),
            TryResult::Locked => return Err("journal authorization is busy; retry".into()),
        };
        if !player.connected
            || player.generation != generation
            || !player.is_service
            || player.room_id.as_deref() != Some(room_id.as_str())
            || !room.is_host(&player_id)
            || !room.hosted
            || !room.official
            || room.status != RoomStatus::InGame
            || room
                .replay
                .as_ref()
                .is_none_or(|replay| replay.game_id != game_id)
        {
            return Err("journal access denied".into());
        }
        let journal_id = format!(
            "{:x}",
            Sha256::digest(format!("{}:{room_id}{game_id}", room_id.len()))
        );
        let writer = format!("{}:{player_id}:{generation}", service.instance);
        match request {
            DecisionJournalRequest::Open { manifest } => {
                let manifest: JournalManifest =
                    serde_json::from_str(&manifest).map_err(|error| error.to_string())?;
                serde_json::to_string(&store.open_writer(&journal_id, &writer, &manifest, true)?)
            }
            DecisionJournalRequest::Append { epoch, batch } => {
                serde_json::to_string(&store.append(&journal_id, &writer, epoch, &batch)?)
            }
            DecisionJournalRequest::Read { after, limit } => {
                serde_json::to_string(&store.read(&journal_id, after, limit as usize)?)
            }
        }
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "journal storage worker failed")?
}
