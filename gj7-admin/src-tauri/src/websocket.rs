// src/websocket.rs

use axum::{
    extract::{
        ws::{WebSocket, WebSocketUpgrade},
        State,
    },
    response::Response,
    routing::get,
    Router,
};
use futures::{sink::SinkExt, stream::StreamExt};
use tokio::sync::{mpsc, Mutex};
use std::{collections::HashMap, sync::Arc, path::PathBuf};
use serde::{Serialize, Deserialize};
use rusqlite::Connection;

use crate::db::attendance::{
    Attendance,
    CreateAttendanceRequest,
    SqliteAttendanceRepository,
    AttendanceRepository
};

// Thread-safe database accessor
#[derive(Clone)]
pub struct DatabaseAccessor {
    pub db_path: PathBuf,
}

impl DatabaseAccessor {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    pub fn get_connection(&self) -> Result<Connection, rusqlite::Error> {
        Connection::open(&self.db_path)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WebSocketError {
    DatabaseError(String),
    SerializationError(String),
    InvalidMessageFormat(String),
}

#[derive(Clone)]
pub struct WebSocketState {
    pub sender_tx: mpsc::Sender<(String, AttendanceEvent)>,
    pub connections: Arc<Mutex<HashMap<String, mpsc::Sender<AttendanceEvent>>>>,
}

#[derive(Clone)]
pub struct AppState {
    pub ws_state: WebSocketState,
    pub db_accessor: DatabaseAccessor,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum AttendanceEvent {
    NewAttendance(CreateAttendanceRequest),
    AttendanceList(Vec<Attendance>),
    Error(WebSocketError),
}

impl WebSocketState {
    pub fn new() -> Self {
        let (sender_tx, mut receiver) = mpsc::channel::<(String, AttendanceEvent)>(100);
        let connections = Arc::new(Mutex::new(HashMap::<String, mpsc::Sender<AttendanceEvent>>::new()));
        
        let connections_clone = connections.clone();
        tokio::spawn(async move {
            while let Some((exclude_client, event)) = receiver.recv().await {
                let connections = connections_clone.lock().await;
                for (client_id, client_tx) in connections.iter() {
                    if *client_id != exclude_client {
                        let _ = client_tx.send(event.clone()).await;
                    }
                }
            }
        });

        WebSocketState {
            sender_tx,
            connections,
        }
    }
}

async fn create_attendance(
    db_accessor: DatabaseAccessor,  // Take ownership instead of reference
    attendance_req: CreateAttendanceRequest,
) -> Result<Attendance, WebSocketError> {
    tokio::task::spawn_blocking(move || {
        let conn = db_accessor.get_connection()
            .map_err(|e| WebSocketError::DatabaseError(e.to_string()))?;
        
        let repo = SqliteAttendanceRepository;
        repo.create_attendance(&conn, attendance_req)
            .map_err(|e| WebSocketError::DatabaseError(e.to_string()))
    })
    .await
    .map_err(|e| WebSocketError::DatabaseError(e.to_string()))?
}

async fn get_all_attendances(
    db_accessor: DatabaseAccessor,  // Take ownership instead of reference
) -> Result<Vec<Attendance>, WebSocketError> {
    tokio::task::spawn_blocking(move || {
        let conn = db_accessor.get_connection()
            .map_err(|e| WebSocketError::DatabaseError(e.to_string()))?;
        
        let repo = SqliteAttendanceRepository;
        repo.get_all_attendances(&conn)
            .map_err(|e| WebSocketError::DatabaseError(e.to_string()))
    })
    .await
    .map_err(|e| WebSocketError::DatabaseError(e.to_string()))?
}

#[axum::debug_handler]
pub async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let client_id = uuid::Uuid::new_v4().to_string();
    let (client_tx, mut client_rx) = mpsc::channel(100);
    
    {
        let mut connections = state.ws_state.connections.lock().await;
        connections.insert(client_id.clone(), client_tx);
    }
    
    let sender_task = {
        let client_id = client_id.clone();
        tokio::spawn(async move {
            while let Some(event) = client_rx.recv().await {
                if let Ok(msg) = serde_json::to_string(&event) {
                    if sender.send(axum::extract::ws::Message::Text(msg)).await.is_err() {
                        break;
                    }
                }
            }
        })
    };

    let receiver_task = {
        let ws_state = state.ws_state.clone();
        let db_accessor = state.db_accessor.clone();  // Clone here
        let client_id = client_id.clone();
        
        tokio::spawn(async move {
            while let Some(Ok(message)) = receiver.next().await {
                match message {
                    axum::extract::ws::Message::Text(text) => {
                        match serde_json::from_str(&text) {
                            Ok(AttendanceEvent::NewAttendance(attendance_req)) => {
                                match create_attendance(db_accessor.clone(), attendance_req.clone()).await {
                                    Ok(_) => {
                                        let _ = ws_state.sender_tx.send((
                                            client_id.clone(),
                                            AttendanceEvent::NewAttendance(attendance_req)
                                        )).await;
                                    },
                                    Err(e) => {
                                        let _ = ws_state.sender_tx.send((
                                            client_id.clone(),
                                            AttendanceEvent::Error(e)
                                        )).await;
                                    }
                                }
                            },
                            Ok(AttendanceEvent::AttendanceList(_)) => {
                                match get_all_attendances(db_accessor.clone()).await {
                                    Ok(attendances) => {
                                        let _ = ws_state.sender_tx.send((
                                            client_id.clone(),
                                            AttendanceEvent::AttendanceList(attendances)
                                        )).await;
                                    },
                                    Err(e) => {
                                        let _ = ws_state.sender_tx.send((
                                            client_id.clone(),
                                            AttendanceEvent::Error(e)
                                        )).await;
                                    }
                                }
                            },
                            Err(_) => {
                                let _ = ws_state.sender_tx.send((
                                    client_id.clone(),
                                    AttendanceEvent::Error(WebSocketError::InvalidMessageFormat(
                                        "Invalid message format".to_string()
                                    ))
                                )).await;
                            },
                            _ => {}
                        }
                    },
                    axum::extract::ws::Message::Close(_) => break,
                    _ => {}
                }
            }
        })
    };

    tokio::select! {
        _ = sender_task => {},
        _ = receiver_task => {},
    }

    let mut connections = state.ws_state.connections.lock().await;
    connections.remove(&client_id);
}

pub fn create_websocket_routes(db_path: PathBuf) -> Router {
    let ws_state = WebSocketState::new();
    let db_accessor = DatabaseAccessor::new(db_path);
    
    let app_state = AppState {
        ws_state,
        db_accessor,
    };
    
    Router::new()
        .route("/ws", get(websocket_handler))
        .with_state(app_state)
}