use std::{
    net::{TcpStream, ToSocketAddrs},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender, TryRecvError},
    },
    thread,
    time::Duration,
};

use serde_json::{Value, json};
use tungstenite::{Message as Frame, stream::MaybeTlsStream};

use crate::host::{HostAddress, Message, TranscriptRow};

pub enum Command {
    Send(String),
    Interrupt,
}

pub enum Event {
    Ready(Vec<TranscriptRow>, bool),
    Message(Message),
    Part(Value),
    Append { part_id: String, delta: String },
    Control(bool),
    Disconnected(String),
    Reconnecting(String),
    Notice(String),
}

#[derive(Default)]
struct WireState {
    registered: bool,
    ready: bool,
    controller: bool,
}

impl WireState {
    fn receive(&mut self, packet: &Value, session_id: &str, client_id: &str) -> Option<Event> {
        match packet.get("type")?.as_str()? {
            "client.registered" => {
                self.registered = true;
                None
            }
            "client.rejected" => Some(Event::Disconnected("Client registration rejected".into())),
            "session.resumed" if packet.pointer("/session/id")?.as_str()? == session_id => {
                self.controller = controller(packet.get("control"), client_id);
                let rows = packet
                    .pointer("/transcript/messages")
                    .or_else(|| packet.get("messages"))
                    .and_then(|value| serde_json::from_value(value.clone()).ok())?;
                self.ready = true;
                Some(Event::Ready(rows, self.controller))
            }
            "session.control.updated"
                if self.ready && packet.pointer("/control/sessionId")?.as_str()? == session_id =>
            {
                self.controller = controller(packet.get("control"), client_id);
                Some(Event::Control(self.controller))
            }
            "session.action_rejected" if packet.get("sessionId")?.as_str()? == session_id => {
                let code = packet
                    .get("code")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                Some(Event::Notice(format!(
                    "Action rejected by host ({code}). Check session control."
                )))
            }
            "error" if packet.get("code").and_then(Value::as_str) == Some("not_found") => Some(
                Event::Disconnected("Session no longer exists on this host".into()),
            ),
            "error" => Some(Event::Notice(
                "Host reported an error. Check the session on the host.".into(),
            )),
            "ask.request" => Some(Event::Notice(
                "A tool needs approval. Use the web client to respond.".into(),
            )),
            "ask.pending_sync"
                if packet
                    .get("requests")?
                    .as_array()
                    .is_some_and(|requests| !requests.is_empty()) =>
            {
                Some(Event::Notice(
                    "A tool needs approval. Use the web client to respond.".into(),
                ))
            }
            "message.created" | "message.updated"
                if self.ready && packet.pointer("/message/sessionId")?.as_str()? == session_id =>
            {
                serde_json::from_value(packet.get("message")?.clone())
                    .ok()
                    .map(Event::Message)
            }
            "part.created" | "part.updated"
                if self.ready && packet.get("sessionId")?.as_str()? == session_id =>
            {
                Some(Event::Part(packet.get("part")?.clone()))
            }
            "part.append"
                if self.ready
                    && packet.get("sessionId")?.as_str()? == session_id
                    && packet.get("field")?.as_str()? == "text" =>
            {
                Some(Event::Append {
                    part_id: packet.get("partId")?.as_str()?.to_string(),
                    delta: packet.get("delta")?.as_str()?.to_string(),
                })
            }
            "session.interrupted" if packet.get("sessionId")?.as_str()? == session_id => {
                Some(Event::Notice("Turn interrupted".into()))
            }
            _ => None,
        }
    }
}

fn controller(control: Option<&Value>, client_id: &str) -> bool {
    control
        .and_then(|value| value.get("controllerClientId"))
        .and_then(Value::as_str)
        == Some(client_id)
}

fn ws_url(address: &HostAddress) -> String {
    let mut url = url::Url::parse(&address.url).expect("validated host origin");
    url.set_scheme(if url.scheme() == "https" { "wss" } else { "ws" })
        .expect("supported scheme");
    url.set_path("/ws");
    if let Some(token) = &address.token {
        url.query_pairs_mut().append_pair("token", token);
    }
    url.to_string()
}

struct ConnectFailure {
    message: String,
    retryable: bool,
}

fn connect(
    address: &HostAddress,
) -> Result<tungstenite::WebSocket<MaybeTlsStream<TcpStream>>, ConnectFailure> {
    let retry = |message: &str| ConnectFailure {
        message: message.into(),
        retryable: true,
    };
    let url = ws_url(address);
    let parsed = url::Url::parse(&url).map_err(|_| retry("Invalid WebSocket address"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| retry("Missing WebSocket host"))?;
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| retry("Missing WebSocket port"))?;
    let target = (host, port)
        .to_socket_addrs()
        .map_err(|_| retry("Cannot resolve host"))?;
    let mut stream = None;
    for target in target {
        if let Ok(socket) = TcpStream::connect_timeout(&target, Duration::from_secs(5)) {
            stream = Some(socket);
            break;
        }
    }
    let stream = stream.ok_or_else(|| retry("Cannot connect to host"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| retry("Cannot set socket timeout"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| retry("Cannot set socket timeout"))?;
    let (mut socket, _) = tungstenite::client_tls_with_config(url, stream, None, None).map_err(
        |error| match error {
            tungstenite::HandshakeError::Failure(tungstenite::Error::Http(response))
                if matches!(response.status().as_u16(), 401 | 403) =>
            {
                ConnectFailure {
                    message: "Host rejected WebSocket credentials".into(),
                    retryable: false,
                }
            }
            _ => retry("WebSocket handshake failed"),
        },
    )?;
    let timeout = Some(Duration::from_millis(200));
    match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => stream.set_read_timeout(timeout),
        MaybeTlsStream::Rustls(stream) => stream.sock.set_read_timeout(timeout),
        _ => return Err(retry("Unsupported WebSocket transport")),
    }
    .map_err(|_| retry("Cannot set socket timeout"))?;
    Ok(socket)
}

pub fn start(
    address: HostAddress,
    session_id: String,
    client_id: String,
) -> (
    SyncSender<Command>,
    async_channel::Receiver<Event>,
    Arc<AtomicBool>,
) {
    let (commands, input) = mpsc::sync_channel(32);
    let (output, events) = async_channel::bounded(128);
    let cancel = Arc::new(AtomicBool::new(false));
    let worker_cancel = cancel.clone();
    thread::spawn(move || {
        run(
            &address,
            &session_id,
            &client_id,
            input,
            &output,
            &worker_cancel,
        );
    });
    (commands, events, cancel)
}

fn send(
    socket: &mut tungstenite::WebSocket<MaybeTlsStream<TcpStream>>,
    packet: Value,
) -> Result<(), String> {
    socket
        .send(Frame::Text(packet.to_string().into()))
        .map_err(|_| "WebSocket send failed".into())
}

fn retry_delay(failures: u32) -> Duration {
    Duration::from_secs(1 << failures.saturating_sub(1).min(3))
}

fn wait_retry(commands: &Receiver<Command>, cancel: &AtomicBool, delay: Duration) -> bool {
    let until = std::time::Instant::now() + delay;
    while !cancel.load(Ordering::Relaxed) {
        // Commands from the lost connection must never be replayed after resume.
        loop {
            if cancel.load(Ordering::Relaxed) {
                return false;
            }
            match commands.try_recv() {
                Ok(_) => {}
                Err(TryRecvError::Disconnected) => return false,
                Err(TryRecvError::Empty) => break,
            }
        }
        let Some(remaining) = until.checked_duration_since(std::time::Instant::now()) else {
            return !cancel.load(Ordering::Relaxed);
        };
        thread::sleep(remaining.min(Duration::from_millis(100)));
    }
    false
}

fn run(
    address: &HostAddress,
    session_id: &str,
    client_id: &str,
    commands: Receiver<Command>,
    output: &async_channel::Sender<Event>,
    cancel: &AtomicBool,
) {
    let mut failures = 0;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let reason = match connect(address) {
            Ok(mut socket) => match run_connected(
                &mut socket,
                session_id,
                client_id,
                &commands,
                output,
                cancel,
                &mut failures,
            ) {
                Ok(()) => return,
                Err(reason) => reason,
            },
            Err(failure) if !failure.retryable => {
                let _ = output.send_blocking(Event::Disconnected(failure.message));
                return;
            }
            Err(failure) => failure.message,
        };
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        failures = failures.saturating_add(1);
        if output.send_blocking(Event::Reconnecting(reason)).is_err()
            || !wait_retry(&commands, cancel, retry_delay(failures))
        {
            return;
        }
    }
}

fn run_connected(
    mut socket: &mut tungstenite::WebSocket<MaybeTlsStream<TcpStream>>,
    session_id: &str,
    client_id: &str,
    commands: &Receiver<Command>,
    output: &async_channel::Sender<Event>,
    cancel: &AtomicBool,
    failures: &mut u32,
) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        return Ok(());
    }
    let mut state = WireState::default();
    send(
        &mut socket,
        json!({"type":"client.register","client":{"clientId":client_id,"clientType":"desktop","displayName":"Prokop Desktop","interactionMode":"human","capabilities":["chat_ui"]}}),
    )?;
    loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = socket.close(None);
            return Ok(());
        }
        match commands.try_recv() {
            Ok(command) if state.ready && state.controller => match command {
                Command::Send(content) if !content.trim().is_empty() => send(
                    &mut socket,
                    json!({"type":"chat.message","sessionId":session_id,"content":content}),
                )?,
                Command::Interrupt => send(
                    &mut socket,
                    json!({"type":"session.interrupt","sessionId":session_id,"reason":"user_request"}),
                )?,
                _ => {}
            },
            Ok(_) => {
                let _ = output.send_blocking(Event::Notice(
                    "Wait for session control before sending".into(),
                ));
            }
            Err(TryRecvError::Disconnected) => {
                let _ = socket.close(None);
                return Ok(());
            }
            Err(TryRecvError::Empty) => {}
        }
        match socket.read() {
            Ok(Frame::Text(text)) => {
                let packet: Value =
                    serde_json::from_str(&text).map_err(|_| "Invalid host event")?;
                if packet.get("type").and_then(Value::as_str) == Some("ping") {
                    send(&mut socket, json!({"type":"pong"}))?;
                    continue;
                }
                let was_registered = state.registered;
                let event = state.receive(&packet, session_id, client_id);
                if !was_registered && state.registered {
                    send(
                        socket,
                        json!({"type":"session.resume","sessionId":session_id}),
                    )?;
                }
                if let Some(event) = event {
                    let terminal = matches!(event, Event::Disconnected(_));
                    if matches!(event, Event::Ready(_, _)) {
                        *failures = 0;
                    }
                    if output.send_blocking(event).is_err() || terminal {
                        return Ok(());
                    }
                }
            }
            Ok(Frame::Close(_)) => return Err("Host disconnected".into()),
            Ok(_) => {}
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(_) => return Err("Host WebSocket closed".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_then_resume_enables_only_own_control() {
        let mut state = WireState::default();
        state.receive(&json!({"type":"client.registered"}), "s", "mine");
        assert!(state.registered);
        let event = state.receive(&json!({"type":"session.resumed","session":{"id":"s"},"messages":[],"control":{"controllerClientId":"other"}}), "s", "mine");
        assert!(matches!(event, Some(Event::Ready(_, false))));
        assert!(!state.controller);
        state.receive(&json!({"type":"session.control.updated","control":{"sessionId":"s","controllerClientId":"mine"}}), "s", "mine");
        assert!(state.controller);
        assert!(
            state
                .receive(
                    &json!({"type":"part.append","sessionId":"else","partId":"p","delta":"hi"}),
                    "s",
                    "mine"
                )
                .is_none()
        );
    }

    #[test]
    fn resume_is_authoritative_and_deltas_are_session_scoped() {
        let mut state = WireState::default();
        let append =
            json!({"type":"part.append","sessionId":"s","partId":"p","field":"text","delta":"!"});
        assert!(state.receive(&append, "s", "mine").is_none());
        assert!(
            state
                .receive(
                    &json!({"type":"session.resumed","session":{"id":"other"},"messages":[]}),
                    "s",
                    "mine"
                )
                .is_none()
        );
        assert!(!state.ready);
        let resumed = json!({"type":"session.resumed","session":{"id":"s"},"transcript":{"messages":[{"message":{"id":"m","role":"assistant"},"parts":[{"id":"p","messageId":"m","type":"text","text":"Hello"}]}]},"control":{"controllerClientId":"mine"}});
        let Some(Event::Ready(rows, true)) = state.receive(&resumed, "s", "mine") else {
            panic!("expected own resumed snapshot")
        };
        assert_eq!(rows[0].text(), "Hello");
        assert!(
            matches!(state.receive(&append, "s", "mine"), Some(Event::Append { part_id, delta }) if part_id == "p" && delta == "!")
        );
        assert!(
            state
                .receive(
                    &json!({"type":"part.updated","sessionId":"other","part":{"id":"p"}}),
                    "s",
                    "mine"
                )
                .is_none()
        );
        assert!(state.receive(&json!({"type":"message.created","message":{"id":"m2","role":"assistant","sessionId":"other"}}), "s", "mine").is_none());
        assert!(matches!(state.receive(&json!({"type":"session.control.updated","control":{"sessionId":"s","controllerClientId":"other"}}), "s", "mine"), Some(Event::Control(false))));
    }

    #[test]
    fn interruption_and_pending_approval_are_not_cross_session_deltas() {
        let mut state = WireState::default();
        assert!(
            state
                .receive(
                    &json!({"type":"session.interrupted","sessionId":"other"}),
                    "s",
                    "mine"
                )
                .is_none()
        );
        assert!(matches!(state.receive(&json!({"type":"session.interrupted","sessionId":"s","result":{"interrupted":true}}), "s", "mine"), Some(Event::Notice(_))));
        assert!(
            state
                .receive(
                    &json!({"type":"ask.pending_sync","requests":[]}),
                    "s",
                    "mine"
                )
                .is_none()
        );
        assert!(matches!(
            state.receive(
                &json!({"type":"ask.pending_sync","requests":[{"toolCallId":"t"}]}),
                "s",
                "mine"
            ),
            Some(Event::Notice(_))
        ));
        assert!(
            matches!(state.receive(&json!({"type":"session.action_rejected","sessionId":"s","code":"not_controller"}), "s", "mine"), Some(Event::Notice(text)) if text.contains("not_controller"))
        );
    }

    #[test]
    fn cancelled_worker_never_connects_or_emits_events() {
        let host = HostAddress::new("local", "http://127.0.0.1:1", None).unwrap();
        let (_commands, receiver) = mpsc::sync_channel(1);
        let (sender, events) = async_channel::bounded(1);
        let cancel = AtomicBool::new(true);
        run(&host, "s", "mine", receiver, &sender, &cancel);
        assert!(events.try_recv().is_err());
    }

    #[test]
    fn retry_wait_discards_commands_and_stops_on_cancel_or_drop() {
        assert_eq!(retry_delay(1), Duration::from_secs(1));
        assert_eq!(retry_delay(5), Duration::from_secs(8));
        let (sender, receiver) = mpsc::sync_channel(2);
        sender.send(Command::Send("never replay".into())).unwrap();
        sender.send(Command::Interrupt).unwrap();
        let cancel = AtomicBool::new(false);
        assert!(wait_retry(&receiver, &cancel, Duration::ZERO));
        assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
        cancel.store(true, Ordering::Relaxed);
        assert!(!wait_retry(&receiver, &cancel, Duration::from_secs(1)));
        cancel.store(false, Ordering::Relaxed);
        drop(sender);
        assert!(!wait_retry(&receiver, &cancel, Duration::from_secs(1)));
    }

    #[test]
    fn a_new_connection_requires_its_own_authoritative_resume() {
        let mut first = WireState::default();
        first.receive(&json!({"type":"client.registered"}), "s", "mine");
        assert!(matches!(first.receive(&json!({"type":"session.resumed","session":{"id":"s"},"messages":[],"control":{"controllerClientId":"mine"}}), "s", "mine"), Some(Event::Ready(_, true))));
        let mut reconnect = WireState::default();
        assert!(reconnect.receive(&json!({"type":"message.created","message":{"id":"m","sessionId":"s","role":"assistant"}}), "s", "mine").is_none());
        assert!(!reconnect.ready && !reconnect.controller);
        reconnect.receive(&json!({"type":"client.registered"}), "s", "mine");
        assert!(matches!(reconnect.receive(&json!({"type":"session.resumed","session":{"id":"s"},"transcript":{"messages":[]},"control":{"controllerClientId":"other"}}), "s", "mine"), Some(Event::Ready(_, false))));
        assert!(matches!(
            reconnect.receive(&json!({"type":"error","code":"not_found"}), "s", "mine"),
            Some(Event::Disconnected(_))
        ));
    }

    #[test]
    fn token_is_escaped_and_not_part_of_host_origin() {
        let host = HostAddress::new("one", "https://example.com", Some("a&b?c".into())).unwrap();
        assert_eq!(ws_url(&host), "wss://example.com/ws?token=a%26b%3Fc");
    }
}
