use futures_util::{SinkExt, StreamExt};
use hyper::{service::service_fn, Body, Request, Response, Server, StatusCode};
use hyper_tungstenite::HyperWebsocket;
use rand::distributions::{Alphanumeric, DistString};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{sync::broadcast, time::interval};
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info};

const MAX_HISTORY: usize = 500;
const MAX_PARTICIPANTS: usize = 4;
const ROOM_CLEANUP_HOURS: u64 = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
    #[serde(rename = "newroom")]
    NewRoom {
        #[serde(rename = "socketId")]
        socket_id: Option<String>,
    },
    #[serde(rename = "fetchRoom")]
    FetchRoom {
        id: String,
        #[serde(rename = "socketId")]
        socket_id: Option<String>,
    },
    #[serde(rename = "keyPress")]
    KeyPress {
        key: String,
        #[serde(rename = "cursorPos")]
        cursor_pos: Option<usize>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
enum ServerMessage {
    #[serde(rename = "gotRoom")]
    GotRoom { room: RoomView },
    #[serde(rename = "room-is-crowded")]
    RoomIsCrowded { message: String },
    #[serde(rename = "committed")]
    Committed { r#final: String, source: String },
    #[serde(rename = "keyPress")]
    KeyPress {
        key: String,
        source: String,
        #[serde(rename = "cursorPos")]
        cursor_pos: Option<usize>,
    },
}

#[derive(Debug, Clone, Serialize)]
struct RoomView {
    messages: HashMap<String, Vec<String>>,
    participants: usize,
    id: String,
    #[serde(rename = "yourId")]
    your_id: String,
    #[serde(rename = "theirId")]
    their_id: Option<String>,
    #[serde(rename = "otherParticipantIds")]
    other_participant_ids: Vec<String>,
}

#[derive(Debug)]
struct Participant {
    id: String,
    sender: broadcast::Sender<ServerMessage>,
}

#[derive(Debug)]
struct Room {
    id: String,
    participants: Vec<Participant>,
    messages: HashMap<String, Vec<String>>,
    last_update: SystemTime,
}

impl Room {
    fn new(id: String) -> Self {
        Self {
            id,
            participants: Vec::new(),
            messages: HashMap::new(),
            last_update: SystemTime::now(),
        }
    }

    fn join(
        &mut self,
        participant_id: String,
        sender: broadcast::Sender<ServerMessage>,
    ) -> Result<(), String> {
        if self.participants.len() >= MAX_PARTICIPANTS {
            return Err("Room is full (max 4 participants).".to_string());
        }

        info!(
            "Socket {} joining room {}, {} participants already connected",
            participant_id,
            self.id,
            self.participants.len()
        );

        self.participants.push(Participant {
            id: participant_id.clone(),
            sender,
        });

        if self.participants.len() == 2 {
            info!("Room {} started chatting", self.id);
        }

        if !self.messages.contains_key(&participant_id) {
            self.messages
                .insert(participant_id.clone(), vec![String::new()]);
        }

        let messages = self.messages.get_mut(&participant_id).unwrap();
        let recent_join =
            messages.len() >= 2 && messages[messages.len() - 2].contains("has joined");

        if !recent_join {
            messages.push(format_event_message(&participant_id, "joined"));
            messages.push(String::new());
            self.prune_history(&participant_id);
        }


        self.last_update = SystemTime::now();
        Ok(())
    }

    fn leave(&mut self, participant_id: &str) {
        self.participants.retain(|p| p.id != participant_id);

        if let Some(messages) = self.messages.get_mut(participant_id) {
            messages.push(format_event_message(participant_id, "left"));
            messages.push(String::new());
            self.prune_history(participant_id);
        }

        if self.participants.len() == 1 {
            info!("Room {} stopped chatting", self.id);
        }


        self.last_update = SystemTime::now();
    }

    fn broadcast(&self, message: ServerMessage, exclude_id: Option<&str>) {
        for participant in &self.participants {
            if let Some(exclude) = exclude_id {
                if participant.id == exclude {
                    continue;
                }
            }
            let _ = participant.sender.send(message.clone());
        }
    }

    fn render(&self, socket_id: &str) -> RoomView {
        let other_ids: Vec<String> = self
            .participants
            .iter()
            .filter(|p| p.id != socket_id)
            .map(|p| p.id.clone())
            .collect();

        RoomView {
            messages: self.messages.clone(),
            participants: self.participants.len(),
            id: self.id.clone(),
            your_id: socket_id.to_string(),
            their_id: other_ids.first().cloned(),
            other_participant_ids: other_ids,
        }
    }

    fn notify_participants(&self) {
        for participant in &self.participants {
            let room_view = self.render(&participant.id);
            let _ = participant
                .sender
                .send(ServerMessage::GotRoom { room: room_view });
        }
    }

    fn handle_keypress(&mut self, participant_id: &str, key: &str, cursor_pos: Option<usize>) {
        if key == "Enter" {
            let final_msg = self.messages.get(participant_id)
                .and_then(|m| m.last())
                .unwrap_or(&String::new())
                .clone();

            self.broadcast(
                ServerMessage::Committed {
                    r#final: final_msg,
                    source: participant_id.to_string(),
                },
                Some(participant_id),
            );

            if let Some(messages) = self.messages.get_mut(participant_id) {
                messages.push(String::new());
                self.prune_history(participant_id);
            }
            return;
        }

        self.broadcast(
            ServerMessage::KeyPress {
                key: key.to_string(),
                source: participant_id.to_string(),
                cursor_pos,
            },
            Some(participant_id),
        );

        let Some(pos) = cursor_pos else { return };
        let Some(messages) = self.messages.get_mut(participant_id) else { return };
        let Some(current_line) = messages.last_mut() else { return };

        match key {
            "CtrlK" => current_line.truncate(pos),
            "DeleteAt" | "Delete" if pos < current_line.len() => {
                current_line.remove(pos);
            }
            "Backspace" if pos > 0 && pos <= current_line.len() => {
                current_line.remove(pos - 1);
            }
            "Space" if pos <= current_line.len() => {
                current_line.insert(pos, ' ');
            }
            _ if !is_non_event(key) && pos <= current_line.len() && key.len() == 1 => {
                current_line.insert_str(pos, key);
            }
            _ => {}
        }

        self.last_update = SystemTime::now();
    }

    fn prune_history(&mut self, participant_id: &str) {
        if let Some(messages) = self.messages.get_mut(participant_id) {
            if messages.len() > MAX_HISTORY {
                messages.drain(0..messages.len() - MAX_HISTORY);
            }
        }
    }
}

fn is_non_event(key: &str) -> bool {
    matches!(
        key,
        "Shift"
            | "Meta"
            | "Control"
            | "Alt"
            | "Enter"
            | "Escape"
            | "Backspace"
            | "ArrowLeft"
            | "ArrowRight"
            | "ArrowUp"
            | "ArrowDown"
            | "Tab"
            | "Delete"
            | "DeleteAt"
            | "CtrlA"
            | "CtrlE"
            | "CtrlK"
            | "CtrlB"
            | "CtrlF"
    )
}

fn format_event_message(participant_id: &str, event: &str) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    format!(
        "> {} has {} at {}Z",
        &participant_id[..4.min(participant_id.len())],
        event,
        chrono::DateTime::from_timestamp(now as i64, 0)
            .unwrap()
            .format("%Y-%m-%d %H:%M:%S")
    )
}

fn generate_random_string(length: usize) -> String {
    Alphanumeric.sample_string(&mut rand::thread_rng(), length)
}

type Rooms = Arc<Mutex<HashMap<String, Room>>>;

fn join_or_create_room(
    rooms: &Rooms,
    room_id: &str,
    participant_id: String,
    tx: broadcast::Sender<ServerMessage>,
) -> Result<(), String> {
    let mut rooms_lock = rooms.lock().unwrap();
    if let Some(room) = rooms_lock.get_mut(room_id) {
        room.join(participant_id, tx)?;
    } else {
        let mut room = Room::new(room_id.to_string());
        room.join(participant_id, tx)?;
        rooms_lock.insert(room_id.to_string(), room);
    }

    if let Some(room) = rooms_lock.get(room_id) {
        room.notify_participants();
    }
    Ok(())
}

async fn handle_websocket(websocket: HyperWebsocket, rooms: Rooms) {
    let ws_stream = match websocket.await {
        Ok(stream) => stream,
        Err(_) => return,
    };
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let (tx, mut rx) = broadcast::channel::<ServerMessage>(32);

    let mut participant_id = String::new();
    let mut room_id = String::new();

    let sender_task = tokio::spawn(async move {
        while let Ok(message) = rx.recv().await {
            if let Ok(json) = serde_json::to_string(&message) {
                if ws_sender.send(Message::Text(json)).await.is_err() {
                    break;
                }
            }
        }
    });

    while let Some(msg) = ws_receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) {
                    match client_msg {
                        ClientMessage::NewRoom { socket_id } => {
                            participant_id =
                                socket_id.unwrap_or_else(|| generate_random_string(20));
                            room_id = generate_random_string(6);

                            if let Err(err) =
                                join_or_create_room(&rooms, &room_id, participant_id.clone(), tx.clone())
                            {
                                let _ = tx.send(ServerMessage::RoomIsCrowded { message: err });
                            }
                        }
                        ClientMessage::FetchRoom { id, socket_id } => {
                            participant_id =
                                socket_id.unwrap_or_else(|| generate_random_string(20));
                            room_id = id;

                            if let Err(err) =
                                join_or_create_room(&rooms, &room_id, participant_id.clone(), tx.clone())
                            {
                                let _ = tx.send(ServerMessage::RoomIsCrowded { message: err });
                            }
                        }
                        ClientMessage::KeyPress { key, cursor_pos } => {
                            let mut rooms_lock = rooms.lock().unwrap();
                            if let Some(room) = rooms_lock.get_mut(&room_id) {
                                room.handle_keypress(&participant_id, &key, cursor_pos);
                            }
                        }
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Err(_) => break,
            _ => {}
        }
    }

    {
        let mut rooms_lock = rooms.lock().unwrap();
        if let Some(room) = rooms_lock.get_mut(&room_id) {
            room.leave(&participant_id);
            if room.participants.is_empty() {
                info!(
                    "Room {} is now empty, will be cleaned up in {} hours",
                    room_id, ROOM_CLEANUP_HOURS
                );
            } else {
                room.notify_participants();
            }
        }
    }

    sender_task.abort();
}

fn content_type_for(path: &str) -> &'static str {
    if path.ends_with(".js") {
        "application/javascript"
    } else if path.ends_with(".css") {
        "text/css"
    } else {
        "text/html"
    }
}

async fn serve_file(path: &str) -> Result<Response<Body>, hyper::Error> {
    match tokio::fs::read(path).await {
        Ok(content) => Ok(Response::builder()
            .status(StatusCode::OK)
            .header("content-type", content_type_for(path))
            .body(Body::from(content))
            .unwrap()),
        Err(_) => Ok(Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::empty())
            .unwrap()),
    }
}

async fn handle_request(req: Request<Body>, rooms: Rooms) -> Result<Response<Body>, hyper::Error> {
    let uri = req.uri();

    if uri.path() == "/ws" {
        if hyper_tungstenite::is_upgrade_request(&req) {
            let (response, websocket) = hyper_tungstenite::upgrade(req, None).unwrap();
            tokio::spawn(handle_websocket(websocket, rooms));
            Ok(response)
        } else {
            Ok(Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::empty())
                .unwrap())
        }
    } else if uri.path().starts_with("/gui") {
        let file_path = format!(
            "gui{}",
            uri.path().strip_prefix("/gui").unwrap_or("/index.html")
        );
        serve_file(&file_path).await
    } else {
        serve_file("gui/index.html").await
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let rooms: Rooms = Arc::new(Mutex::new(HashMap::new()));
    let rooms_cleanup = rooms.clone();

    tokio::spawn(async move {
        let mut interval = interval(Duration::from_secs(3600));

        loop {
            interval.tick().await;
            let mut rooms_lock = rooms_cleanup.lock().unwrap();
            let cutoff = SystemTime::now() - Duration::from_secs(ROOM_CLEANUP_HOURS * 3600);

            let to_remove: Vec<String> = rooms_lock
                .iter()
                .filter(|(_, room)| room.participants.is_empty() && room.last_update < cutoff)
                .map(|(id, _)| id.clone())
                .collect();

            for room_id in to_remove {
                rooms_lock.remove(&room_id);
                info!("Cleaned up abandoned room: {}", room_id);
            }
        }
    });

    let make_service = hyper::service::make_service_fn(move |_conn| {
        let rooms = rooms.clone();
        async move { Ok::<_, hyper::Error>(service_fn(move |req| handle_request(req, rooms.clone()))) }
    });

    let addr = SocketAddr::from(([0, 0, 0, 0], 8090));
    let server = Server::bind(&addr).serve(make_service);

    info!("Server running on http://0.0.0.0:8090");

    if let Err(e) = server.await {
        error!("Server error: {}", e);
    }
}
