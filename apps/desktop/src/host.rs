use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Session {
    pub id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub title: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Message {
    pub id: String,
    pub role: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct TranscriptRow {
    pub message: Message,
    #[serde(default)]
    pub parts: Vec<serde_json::Value>,
}

impl TranscriptRow {
    pub fn text(&self) -> String {
        self.parts
            .iter()
            .filter_map(|part| {
                (part.get("type")?.as_str()? == "text")
                    .then(|| part.get("text")?.as_str())
                    .flatten()
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

#[derive(Deserialize)]
struct ServerInfo {
    name: String,
    runtime: String,
    #[serde(rename = "installationId")]
    installation_id: Option<String>,
    features: ServerFeatures,
}

#[derive(Deserialize)]
struct ServerFeatures {
    websocket: bool,
    sessions: bool,
    authentication: bool,
}

fn validate_info(info: &ServerInfo) -> Result<(), String> {
    if info.name != "AI Agent Server"
        || info.runtime != "bun"
        || !info.features.websocket
        || !info.features.sessions
    {
        return Err("The address is not a compatible Prokop host. Check the host URL.".into());
    }
    Ok(())
}

fn validate_local_identity(actual: Option<&str>, expected: &str) -> Result<(), String> {
    if actual != Some(expected) {
        return Err("This address belongs to an older or different Prokop installation. Upgrade the host or check its data root; no second host was started.".into());
    }
    Ok(())
}

fn needs_auth(path: &str) -> bool {
    path != "/info"
}

fn request_error(error: ureq::Error) -> String {
    match error {
        ureq::Error::StatusCode(401 | 403) => {
            "Host requires a valid token. Set PROKOPAI_AUTH_TOKEN and restart the desktop.".into()
        }
        ureq::Error::StatusCode(code) => {
            format!("Host returned HTTP {code}. Check its address and status.")
        }
        _ => "Cannot reach the configured host. Check its status, then refresh hosts.".into(),
    }
}

#[derive(Deserialize)]
struct WorkspaceResponse {
    workspaces: Vec<Workspace>,
}
#[derive(Deserialize)]
struct SessionResponse {
    sessions: Vec<Session>,
}
#[derive(Deserialize)]
struct TranscriptResponse {
    messages: Vec<TranscriptRow>,
}

#[derive(Deserialize)]
struct CreatedWorkspace {
    workspace: Workspace,
}

#[derive(Deserialize)]
struct CreatedSession {
    session: Session,
}

#[derive(Serialize)]
struct WorkspaceCreate<'a> {
    name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<&'a str>,
    #[serde(rename = "isVirtual")]
    is_virtual: bool,
}

#[derive(Serialize)]
struct SessionCreate<'a> {
    #[serde(rename = "workspaceId")]
    workspace_id: &'a str,
    title: &'a str,
}

fn nonempty<'a>(value: &'a str, label: &str) -> Result<&'a str, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(format!("{label} is required"))
    } else {
        Ok(trimmed)
    }
}

#[derive(Clone)]
pub struct HostAddress {
    pub id: String,
    pub url: String,
    pub token: Option<String>,
    pub local: bool,
}

impl HostAddress {
    pub fn new(
        id: impl Into<String>,
        url: impl Into<String>,
        token: Option<String>,
    ) -> Result<Self, String> {
        let url = url.into();
        let parsed = url::Url::parse(&url).map_err(|_| "Invalid host address")?;
        let loopback = matches!(
            parsed.host_str(),
            Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
        );
        if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
            return Err("Remote hosts require HTTPS; plaintext HTTP is limited to loopback".into());
        }
        if parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || parsed.path() != "/"
        {
            return Err(
                "Host address must be an origin without credentials, path, query, or fragment"
                    .into(),
            );
        }
        Ok(Self {
            id: id.into(),
            url: parsed.origin().ascii_serialization(),
            token,
            local: false,
        })
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}/api{path}", self.url)
    }

    fn get<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T, String> {
        let agent = ureq::Agent::new_with_config(
            ureq::Agent::config_builder()
                .timeout_global(Some(Duration::from_secs(8)))
                .max_redirects(0)
                .build(),
        );
        let mut request = agent.get(&self.endpoint(path));
        if needs_auth(path) {
            if let Some(token) = &self.token {
                request = request.header("Authorization", &format!("Bearer {token}"));
            }
        }
        request
            .call()
            .map_err(request_error)?
            .body_mut()
            .read_json::<T>()
            .map_err(|_| "Invalid host response. Check the configured address.".into())
    }

    fn post<T: for<'de> Deserialize<'de>, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, String> {
        // No redirects or retries for a request that can create a record.
        let agent = ureq::Agent::new_with_config(
            ureq::Agent::config_builder()
                .timeout_global(Some(Duration::from_secs(8)))
                .max_redirects(0)
                .build(),
        );
        let mut request = agent.post(&self.endpoint(path));
        if let Some(token) = &self.token {
            request = request.header("Authorization", &format!("Bearer {token}"));
        }
        request
            .send_json(body)
            .map_err(request_error)?
            .body_mut()
            .read_json::<T>()
            .map_err(|_| {
                "Host created a record but returned an invalid response. Refresh before retrying."
                    .into()
            })
    }

    pub fn create_workspace(
        &self,
        name: &str,
        path: &str,
        virtual_workspace: bool,
    ) -> Result<Workspace, String> {
        let name = nonempty(name, "Workspace name")?;
        let path = if virtual_workspace {
            None
        } else {
            Some(nonempty(path, "Workspace path")?)
        };
        self.probe()?;
        self.post::<CreatedWorkspace, _>(
            "/workspaces",
            &WorkspaceCreate {
                name,
                path,
                is_virtual: virtual_workspace,
            },
        )
        .map(|response| response.workspace)
    }

    pub fn create_session(&self, workspace_id: &str, title: &str) -> Result<Session, String> {
        let workspace_id = nonempty(workspace_id, "Workspace")?;
        let title = nonempty(title, "Session title")?;
        self.probe()?;
        // A workspace may have been deleted since the last list fetch. A 4xx
        // response is never retried automatically.
        self.post::<CreatedSession, _>(
            "/sessions",
            &SessionCreate {
                workspace_id,
                title,
            },
        )
        .map(|response| response.session)
    }

    pub(crate) fn probe(&self) -> Result<(), String> {
        let info = self.get::<ServerInfo>("/info")?;
        validate_info(&info)?;
        if self.local {
            let expected = crate::local::existing_installation_id()?;
            validate_local_identity(info.installation_id.as_deref(), &expected)?;
        }
        if info.features.authentication {
            if self.token.as_deref().is_none_or(str::is_empty) {
                return Err(
                    "Host requires a token. Set PROKOPAI_AUTH_TOKEN and restart the desktop."
                        .into(),
                );
            }
            let verification = self.get::<serde_json::Value>("/auth/verify")?;
            if verification
                .get("valid")
                .and_then(serde_json::Value::as_bool)
                != Some(true)
            {
                return Err(
                    "Host did not confirm authentication. Check the configured address.".into(),
                );
            }
        }
        Ok(())
    }

    pub fn workspaces(&self) -> Result<Vec<Workspace>, String> {
        self.get::<WorkspaceResponse>("/workspaces")
            .map(|response| response.workspaces)
    }

    pub fn sessions(&self) -> Result<Vec<Session>, String> {
        self.get::<SessionResponse>("/sessions")
            .map(|response| response.sessions)
    }

    pub fn transcript(&self, session_id: &str) -> Result<Vec<TranscriptRow>, String> {
        if session_id.is_empty()
            || !session_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        {
            return Err("Invalid session ID".into());
        }
        self.get::<TranscriptResponse>(&format!("/sessions/{session_id}/transcript?limit=50"))
            .map(|response| response.messages)
    }
}

#[derive(Clone)]
pub struct HostSnapshot {
    pub address: HostAddress,
    pub workspaces: Vec<Workspace>,
    pub sessions: Vec<Session>,
    pub error: Option<String>,
}

impl HostSnapshot {
    pub fn pending(address: HostAddress) -> Self {
        Self {
            address,
            workspaces: Vec::new(),
            sessions: Vec::new(),
            error: None,
        }
    }

    pub fn refresh(&mut self) {
        let prepared = if self.address.local {
            crate::local::prepare(&self.address)
        } else {
            Ok(())
        };
        let result = prepared
            .and_then(|()| self.address.probe())
            .and_then(|()| self.address.workspaces())
            .and_then(|workspaces| {
                self.address
                    .sessions()
                    .map(|sessions| (workspaces, sessions))
            });
        self.apply(result);
    }

    fn apply(&mut self, result: Result<(Vec<Workspace>, Vec<Session>), String>) {
        // An offline host retains its own last known data, never another host's snapshot.
        match result {
            Ok((workspaces, sessions)) => {
                self.workspaces = workspaces;
                self.sessions = sessions;
                self.error = None;
            }
            Err(error) => self.error = Some(error),
        }
    }
}

#[derive(Default)]
pub struct HostIndex {
    pub hosts: Vec<HostSnapshot>,
}

impl HostIndex {
    pub fn replace(&mut self, snapshot: HostSnapshot) {
        if let Some(host) = self
            .hosts
            .iter_mut()
            .find(|host| host.address.id == snapshot.address.id)
        {
            *host = snapshot;
        }
    }

    pub fn session(&self, host_id: &str, session_id: &str) -> Option<&Session> {
        self.hosts
            .iter()
            .find(|host| host.address.id == host_id)?
            .sessions
            .iter()
            .find(|session| session.id == session_id)
    }

    pub fn workspace(&self, host_id: &str, workspace_id: &str) -> Option<&Workspace> {
        self.hosts
            .iter()
            .find(|host| host.address.id == host_id && host.error.is_none())?
            .workspaces
            .iter()
            .find(|workspace| workspace.id == workspace_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creation_payloads_and_envelopes_match_routes() {
        let workspace = WorkspaceCreate {
            name: "Project",
            path: Some("/tmp/project"),
            is_virtual: false,
        };
        assert_eq!(
            serde_json::to_value(workspace).unwrap(),
            serde_json::json!({"name":"Project","path":"/tmp/project","isVirtual":false})
        );
        let virtual_workspace = WorkspaceCreate {
            name: "Notes",
            path: None,
            is_virtual: true,
        };
        assert_eq!(
            serde_json::to_value(virtual_workspace).unwrap(),
            serde_json::json!({"name":"Notes","isVirtual":true})
        );
        assert_eq!(
            serde_json::to_value(SessionCreate {
                workspace_id: "w",
                title: "First"
            })
            .unwrap(),
            serde_json::json!({"workspaceId":"w","title":"First"})
        );
        let created: CreatedWorkspace =
            serde_json::from_str(r#"{"workspace":{"id":"w","name":"Project"}}"#).unwrap();
        let session: CreatedSession =
            serde_json::from_str(r#"{"session":{"id":"s","workspaceId":"w","title":"First"}}"#)
                .unwrap();
        assert_eq!(created.workspace.id, session.session.workspace_id);
        assert!(nonempty("  ", "Title").is_err());
        assert_eq!(nonempty(" First ", "Title").unwrap(), "First");
    }

    #[test]
    fn parses_actual_http_envelopes() {
        let workspaces: WorkspaceResponse =
            serde_json::from_str(r#"{"workspaces":[{"id":"w1","name":"Project"}]}"#).unwrap();
        let sessions: SessionResponse = serde_json::from_str(
            r#"{"sessions":[{"id":"s1","workspaceId":"w1","title":"First"}]}"#,
        )
        .unwrap();
        let transcript: TranscriptResponse = serde_json::from_str(r#"{"messages":[{"message":{"id":"m1","role":"assistant"},"parts":[{"type":"text","text":"Hello"}]}],"pagination":{"hasOlder":false}}"#).unwrap();
        assert_eq!(workspaces.workspaces[0].name, "Project");
        assert_eq!(sessions.sessions[0].workspace_id, "w1");
        assert_eq!(transcript.messages[0].text(), "Hello");
    }

    #[test]
    fn attach_probe_rejects_other_services_and_missing_features() {
        let parse = |body: &str| serde_json::from_str::<ServerInfo>(body).unwrap();
        let valid = parse(
            r#"{"name":"AI Agent Server","runtime":"bun","features":{"websocket":true,"sessions":true,"authentication":true}}"#,
        );
        assert!(validate_info(&valid).is_ok());
        assert!(valid.features.authentication);
        assert!(validate_local_identity(valid.installation_id.as_deref(), "expected").is_err());
        let identified = parse(
            r#"{"name":"AI Agent Server","runtime":"bun","installationId":"expected","features":{"websocket":true,"sessions":true,"authentication":false}}"#,
        );
        assert!(validate_local_identity(identified.installation_id.as_deref(), "expected").is_ok());
        assert!(validate_local_identity(identified.installation_id.as_deref(), "other").is_err());
        let other = parse(
            r#"{"name":"Other","runtime":"bun","features":{"websocket":true,"sessions":true,"authentication":false}}"#,
        );
        assert!(validate_info(&other).is_err());
        let no_ws = parse(
            r#"{"name":"AI Agent Server","runtime":"bun","features":{"websocket":false,"sessions":true,"authentication":false}}"#,
        );
        assert!(validate_info(&no_ws).is_err());
        assert!(serde_json::from_str::<ServerInfo>(r#"{"status":"healthy"}"#).is_err());
    }

    #[test]
    fn attach_errors_distinguish_auth_and_transport_without_echoing_tokens() {
        assert!(
            !needs_auth("/info"),
            "public probe must not send an unverified address the token"
        );
        assert!(needs_auth("/auth/verify"));
        assert!(needs_auth("/workspaces"));
        let auth = request_error(ureq::Error::StatusCode(401));
        assert!(auth.contains("PROKOPAI_AUTH_TOKEN"));
        assert!(!auth.contains("secret-token"));
        assert!(request_error(ureq::Error::StatusCode(404)).contains("404"));
    }

    #[test]
    fn creation_workspace_selection_is_host_scoped_and_rejects_offline_snapshots() {
        let mut one =
            HostSnapshot::pending(HostAddress::new("one", "https://one.example", None).unwrap());
        one.workspaces.push(Workspace {
            id: "same".into(),
            name: "First".into(),
        });
        let mut two =
            HostSnapshot::pending(HostAddress::new("two", "https://two.example", None).unwrap());
        two.workspaces.push(Workspace {
            id: "same".into(),
            name: "Second".into(),
        });
        let mut index = HostIndex {
            hosts: vec![one, two],
        };
        assert_eq!(index.workspace("one", "same").unwrap().name, "First");
        assert_eq!(index.workspace("two", "same").unwrap().name, "Second");
        assert!(index.workspace("two", "missing").is_none());
        index.hosts[1].apply(Err("Offline".into()));
        assert!(index.workspace("two", "same").is_none());
        assert!(index.workspace("one", "same").is_some());
    }

    #[test]
    fn same_session_id_is_scoped_to_host() {
        let address = |id| HostAddress::new(id, "http://127.0.0.1:8742", None).unwrap();
        let mut index = HostIndex {
            hosts: vec![
                HostSnapshot::pending(address("one")),
                HostSnapshot::pending(address("two")),
            ],
        };
        for (id, title) in [("one", "First"), ("two", "Second")] {
            let mut snapshot = HostSnapshot::pending(address(id));
            snapshot.sessions.push(Session {
                id: "same".into(),
                workspace_id: "w".into(),
                title: title.into(),
            });
            index.replace(snapshot);
        }
        assert_eq!(index.session("one", "same").unwrap().title, "First");
        assert_eq!(index.session("two", "same").unwrap().title, "Second");
    }

    #[test]
    fn failing_host_keeps_its_snapshot_and_does_not_replace_another_host() {
        let mut index = HostIndex {
            hosts: vec![
                HostSnapshot::pending(
                    HostAddress::new("one", "http://localhost:8742", None).unwrap(),
                ),
                HostSnapshot::pending(
                    HostAddress::new("two", "https://example.com", None).unwrap(),
                ),
            ],
        };
        for (host, name) in index.hosts.iter_mut().zip(["First", "Second"]) {
            host.apply(Ok((
                vec![Workspace {
                    id: "w".into(),
                    name: name.into(),
                }],
                vec![],
            )));
        }
        let mut second = index.hosts[1].clone();
        second.apply(Err("Host requires a token".into()));
        index.replace(second);
        assert_eq!(index.hosts[0].workspaces[0].name, "First");
        assert!(index.hosts[0].error.is_none());
        assert_eq!(index.hosts[1].workspaces[0].name, "Second");
        assert_eq!(
            index.hosts[1].error.as_deref(),
            Some("Host requires a token")
        );
    }

    #[test]
    fn refuses_plaintext_remote_addresses() {
        assert!(HostAddress::new("remote", "http://example.com:8742", None).is_err());
        assert!(HostAddress::new("remote", "https://example.com", None).is_ok());
        assert!(HostAddress::new("remote", "https://user:secret@example.com", None).is_err());
        assert!(HostAddress::new("remote", "https://example.com/path", None).is_err());
        assert!(HostAddress::new("local", "http://localhost.evil.com", None).is_err());
        assert!(HostAddress::new("local", "http://[::1]:8742", None).is_ok());
    }

    #[test]
    fn offline_host_retains_only_its_own_snapshot() {
        let address = HostAddress::new("one", "http://localhost:8742", None).unwrap();
        let mut snapshot = HostSnapshot::pending(address);
        snapshot.apply(Ok((
            vec![Workspace {
                id: "w1".into(),
                name: "First".into(),
            }],
            vec![],
        )));
        snapshot.apply(Err("Disconnected".into()));
        assert_eq!(snapshot.workspaces[0].name, "First");
        assert_eq!(snapshot.error.as_deref(), Some("Disconnected"));
        snapshot.apply(Ok((vec![], vec![])));
        assert!(snapshot.workspaces.is_empty());
        assert!(snapshot.error.is_none());
    }
}
