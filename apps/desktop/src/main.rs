mod host;
mod live;
mod local;
mod session_list;

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
    mpsc::SyncSender,
};

use gpui_kit::base::Disableable;
use gpui_kit::component::input::{Input, InputEvent, InputState, Textarea, TextareaState};

use gpui_kit::component::scroll::ScrollableElement;
use gpui_kit::component::{
    ActiveTheme, Root,
    button::{Button, ButtonVariants},
    list::{List, ListEvent, ListState},
};
use gpui_kit::{
    AppContext as _, Context, Entity, IntoElement, ParentElement as _, Render, Styled as _,
    Subscription, Window, WindowOptions, div, px,
};
use host::{HostAddress, HostIndex, HostSnapshot, TranscriptRow};
use live::{Command, Event};
use session_list::SessionListDelegate;

const TRANSCRIPT_PAGE_SIZE: usize = 10;

fn transcript_page_range(len: usize, page: usize) -> std::ops::Range<usize> {
    let end = len.saturating_sub(page.saturating_mul(TRANSCRIPT_PAGE_SIZE));
    end.saturating_sub(TRANSCRIPT_PAGE_SIZE)..end
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CreateMode {
    Workspace,
    Session,
}

struct Desktop {
    hosts: HostIndex,
    create_mode: Option<CreateMode>,
    create_host: String,
    create_workspace: Option<String>,
    virtual_workspace: bool,
    create_busy: bool,
    create_generation: u64,
    create_error: Option<String>,
    name_input: Entity<InputState>,
    path_input: Entity<InputState>,
    workspace_search: Entity<InputState>,
    _search_subscription: Subscription,
    refresh_generation: u64,
    selected: Option<(String, String)>,
    transcript: Vec<TranscriptRow>,
    transcript_page: usize,
    transcript_error: Option<String>,
    composer: Entity<TextareaState>,
    session_list: Entity<ListState<SessionListDelegate>>,
    _list_subscription: Subscription,
    client_id: String,
    live_generation: u64,
    live_commands: Option<SyncSender<Command>>,
    live_cancel: Option<Arc<AtomicBool>>,
    can_send: bool,
    snapshot_seen: bool,
    live_ready: bool,
    notice: Option<String>,
}

impl Desktop {
    fn new(
        addresses: Vec<HostAddress>,
        composer: Entity<TextareaState>,
        session_list: Entity<ListState<SessionListDelegate>>,
        list_subscription: Subscription,
        name_input: Entity<InputState>,
        path_input: Entity<InputState>,
        workspace_search: Entity<InputState>,
        search_subscription: Subscription,
    ) -> Self {
        Self {
            hosts: HostIndex {
                hosts: addresses.into_iter().map(HostSnapshot::pending).collect(),
            },
            refresh_generation: 0,
            create_mode: None,
            create_host: String::new(),
            create_workspace: None,
            virtual_workspace: false,
            create_busy: false,
            create_generation: 0,
            create_error: None,
            name_input,
            path_input,
            workspace_search,
            _search_subscription: search_subscription,
            selected: None,
            transcript: Vec::new(),
            transcript_page: 0,
            transcript_error: None,
            composer,
            session_list,
            _list_subscription: list_subscription,
            client_id: format!(
                "desktop-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            ),
            live_generation: 0,
            live_commands: None,
            live_cancel: None,
            can_send: false,
            snapshot_seen: false,
            live_ready: false,
            notice: None,
        }
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.refresh_generation = self.refresh_generation.wrapping_add(1);
        let generation = self.refresh_generation;
        for snapshot in self.hosts.hosts.clone() {
            cx.spawn(async move |this, cx| {
                let snapshot = cx
                    .background_executor()
                    .spawn(async move {
                        let mut snapshot = snapshot;
                        snapshot.refresh();
                        snapshot
                    })
                    .await;
                let _ = this.update(cx, |this, cx| {
                    if this.refresh_generation != generation {
                        return;
                    }
                    this.hosts.replace(snapshot);
                    if this.create_workspace.as_ref().is_some_and(|id| {
                        this.hosts
                            .hosts
                            .iter()
                            .find(|host| host.address.id == this.create_host)
                            .is_some_and(|host| {
                                host.error.is_none()
                                    && !host.workspaces.iter().any(|workspace| &workspace.id == id)
                            })
                    }) {
                        this.create_workspace = None;
                    }
                    this.session_list.update(cx, |list, cx| {
                        list.delegate_mut().update(&this.hosts);
                        cx.notify();
                    });
                    cx.notify();
                });
            })
            .detach();
        }
    }

    fn start_create(&mut self, mode: CreateMode, window: &mut Window, cx: &mut Context<Self>) {
        if self.create_busy {
            return;
        }
        self.create_mode = Some(mode);
        self.create_error = None;
        if self.create_host.is_empty() {
            self.create_host = self
                .hosts
                .hosts
                .first()
                .map(|host| host.address.id.clone())
                .unwrap_or_default();
        }
        self.name_input
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.path_input
            .update(cx, |input, cx| input.set_value("", window, cx));
        cx.notify();
    }

    fn submit_create(&mut self, cx: &mut Context<Self>) {
        if self.create_busy {
            return;
        }
        let Some(mode) = self.create_mode else {
            return;
        };
        let host_id = self.create_host.clone();
        let Some(host) = self
            .hosts
            .hosts
            .iter()
            .find(|host| host.address.id == host_id && host.error.is_none())
        else {
            self.create_error = Some("Host unavailable. Refresh hosts before creating.".into());
            cx.notify();
            return;
        };
        let address = host.address.clone();
        let name = self.name_input.read(cx).value().to_string();
        let path = self.path_input.read(cx).value().to_string();
        let workspace_id = self.create_workspace.clone();
        self.create_error = match mode {
            CreateMode::Workspace if name.trim().is_empty() => {
                Some("Workspace name is required".into())
            }
            CreateMode::Workspace if !self.virtual_workspace && path.trim().is_empty() => {
                Some("Workspace path is required".into())
            }
            CreateMode::Session if name.trim().is_empty() => {
                Some("Session title is required".into())
            }
            CreateMode::Session
                if workspace_id
                    .as_ref()
                    .is_none_or(|id| self.hosts.workspace(&host_id, id).is_none()) =>
            {
                Some("Select a workspace on this host".into())
            }
            _ => None,
        };
        if self.create_error.is_some() {
            cx.notify();
            return;
        }
        let virtual_workspace = self.virtual_workspace;
        self.create_busy = true;
        self.create_generation = self.create_generation.wrapping_add(1);
        let generation = self.create_generation;
        self.create_error = None;
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    match mode {
                        CreateMode::Workspace => address
                            .create_workspace(&name, &path, virtual_workspace)
                            .map(|workspace| (Some(workspace.id), None)),
                        CreateMode::Session => address
                            .create_session(workspace_id.as_deref().unwrap_or_default(), &name)
                            .map(|session| (None, Some(session.id))),
                    }
                })
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.create_generation != generation {
                    return;
                }
                this.create_busy = false;
                match result {
                    Ok((workspace_id, session_id)) => {
                        this.create_mode = None;
                        if let Some(workspace_id) = workspace_id {
                            this.create_workspace = Some(workspace_id);
                            this.notice = Some(
                                "Workspace created. Create a session to start chatting.".into(),
                            );
                        }
                        if session_id.is_some() {
                            this.notice = Some(
                                "Session created. Select it from the refreshed list to connect."
                                    .into(),
                            );
                        }
                        this.refresh(cx);
                    }
                    Err(error) => {
                        this.create_error = Some(format!(
                            "{error} If the request timed out, refresh hosts before retrying."
                        ));
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn open_session(
        &mut self,
        host_id: String,
        session_id: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(host) = self
            .hosts
            .hosts
            .iter()
            .find(|host| host.address.id == host_id)
        else {
            return;
        };
        if host.error.is_some() {
            self.notice = Some(
                "This host is unavailable. Refresh hosts before opening a cached session.".into(),
            );
            cx.notify();
            return;
        }
        let address = host.address.clone();
        self.create_mode = None;
        self.selected = Some((host_id.clone(), session_id.clone()));
        self.composer
            .update(cx, |state, cx| state.set_value("", window, cx));
        self.transcript.clear();
        self.transcript_page = 0;
        self.transcript_error = None;
        self.notice = Some("Connecting to session...".into());
        self.can_send = false;
        self.snapshot_seen = false;
        self.live_ready = false;
        if let Some(cancel) = self.live_cancel.take() {
            cancel.store(true, Ordering::Relaxed);
        }
        self.live_commands = None;
        self.live_generation += 1;
        let generation = self.live_generation;
        let (commands, events, cancel) =
            live::start(address.clone(), session_id.clone(), self.client_id.clone());
        self.live_commands = Some(commands);
        self.live_cancel = Some(cancel);
        let snapshot_address = address;
        let snapshot_id = session_id.clone();
        let snapshot_host = host_id.clone();
        let requested_session = session_id.clone();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { snapshot_address.transcript(&snapshot_id) })
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.live_generation == generation
                    && this.selected.as_ref() == Some(&(snapshot_host, requested_session))
                    && !this.snapshot_seen
                {
                    if let Ok(rows) = result {
                        this.transcript = rows;
                        cx.notify();
                    }
                }
            });
        })
        .detach();
        cx.notify();
        cx.spawn(async move |this, cx| {
            while let Ok(event) = events.recv().await {
                let terminal = matches!(event, Event::Disconnected(_));
                if this
                    .update(cx, |this, cx| {
                        if this.live_generation != generation
                            || this.selected.as_ref()
                                != Some(&(host_id.clone(), session_id.clone()))
                        {
                            return;
                        }
                        this.apply_event(event);
                        cx.notify();
                    })
                    .is_err()
                    || terminal
                {
                    break;
                }
            }
        })
        .detach();
    }

    fn apply_event(&mut self, event: Event) {
        match event {
            Event::Ready(rows, controller) => {
                self.snapshot_seen = true;
                self.live_ready = true;
                self.transcript = rows;
                self.transcript_page = 0;
                self.can_send = controller;
                self.notice = if controller {
                    None
                } else {
                    Some("View only: controlled by another client".into())
                };
            }
            Event::Control(controller) => {
                self.can_send = self.live_ready && controller;
                self.notice = Some(
                    if controller {
                        "Session control available"
                    } else {
                        "Session control lost"
                    }
                    .into(),
                );
            }
            Event::Message(message) => {
                if let Some(row) = self
                    .transcript
                    .iter_mut()
                    .find(|row| row.message.id == message.id)
                {
                    row.message = message;
                } else {
                    self.transcript.push(TranscriptRow {
                        message,
                        parts: Vec::new(),
                    });
                }
            }
            Event::Part(part) => {
                let Some(message_id) = part.get("messageId").and_then(serde_json::Value::as_str)
                else {
                    return;
                };
                let Some(part_id) = part.get("id").and_then(serde_json::Value::as_str) else {
                    return;
                };
                if let Some(row) = self
                    .transcript
                    .iter_mut()
                    .find(|row| row.message.id == message_id)
                {
                    if let Some(existing) = row.parts.iter_mut().find(|value| {
                        value.get("id").and_then(serde_json::Value::as_str) == Some(part_id)
                    }) {
                        *existing = part;
                    } else {
                        row.parts.push(part);
                    }
                }
            }
            Event::Append { part_id, delta } => {
                for row in &mut self.transcript {
                    if let Some(part) = row.parts.iter_mut().find(|part| {
                        part.get("id").and_then(serde_json::Value::as_str) == Some(part_id.as_str())
                    }) {
                        if let Some(serde_json::Value::String(text)) = part.get_mut("text") {
                            text.push_str(&delta);
                        }
                        break;
                    }
                }
            }
            Event::Reconnecting(error) => {
                self.can_send = false;
                self.live_ready = false;
                self.notice = Some(format!(
                    "Connection lost ({error}). Reconnecting; check the transcript before resending any queued action."
                ));
            }
            Event::Disconnected(error) => {
                self.can_send = false;
                self.live_ready = false;
                if let Some(cancel) = self.live_cancel.take() {
                    cancel.store(true, Ordering::Relaxed);
                }
                self.live_commands = None;
                self.notice = Some(format!(
                    "Disconnected: {error}. Reopen the session after fixing the issue."
                ));
            }
            Event::Notice(message) => self.notice = Some(message),
        }
    }

    fn send_message(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.can_send {
            return;
        }
        let value = self.composer.read(cx).value().to_string();
        if value.trim().is_empty() {
            return;
        }
        if let Some(commands) = &self.live_commands {
            if commands.try_send(Command::Send(value)).is_ok() {
                self.composer
                    .update(cx, |state, cx| state.set_value("", window, cx));
            } else {
                self.notice = Some("Cannot queue message. Reopen the session.".into());
            }
        }
        cx.notify();
    }

    fn interrupt(&mut self, cx: &mut Context<Self>) {
        if self.can_send {
            if let Some(commands) = &self.live_commands {
                if commands.try_send(Command::Interrupt).is_err() {
                    self.notice = Some("Cannot interrupt. Reopen the session.".into());
                }
            }
        }
        cx.notify();
    }
}

impl Drop for Desktop {
    fn drop(&mut self) {
        if let Some(cancel) = &self.live_cancel {
            cancel.store(true, Ordering::Relaxed);
        }
    }
}

impl Render for Desktop {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let mut navigation = div()
            .flex()
            .flex_col()
            .w(px(280.))
            .h_full()
            .min_h_0()
            .p_4()
            .gap_3()
            .border_r_1()
            .border_color(theme.border)
            .bg(theme.sidebar)
            .child(div().text_lg().child("Prokop"))
            .child(
                Button::new("refresh-hosts")
                    .ghost()
                    .label("Refresh hosts")
                    .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
            )
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .child(List::new(&self.session_list).search_placeholder("Find a session")),
            )
            .child(
                div()
                    .flex()
                    .gap_2()
                    .child(
                        Button::new("new-workspace")
                            .ghost()
                            .label("Add project")
                            .disabled(self.create_busy)
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.start_create(CreateMode::Workspace, window, cx)
                            })),
                    )
                    .child(
                        Button::new("new-session")
                            .ghost()
                            .label("New session")
                            .disabled(self.create_busy)
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.start_create(CreateMode::Session, window, cx)
                            })),
                    ),
            );
        for host in &self.hosts.hosts {
            if let Some(error) = &host.error {
                navigation = navigation.child(div().text_xs().child(format!(
                    "{} ({}): {error}",
                    host.address.id, host.address.url
                )));
            }
        }

        if let Some(mode) = self.create_mode {
            let mut form = div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .h_full()
                .overflow_y_scrollbar()
                .p_5()
                .gap_3()
                .child(div().text_lg().child(match mode {
                    CreateMode::Workspace => "Add project",
                    CreateMode::Session => "New session",
                }))
                .child(div().child("Host"));
            for host in &self.hosts.hosts {
                let host_id = host.address.id.clone();
                let label = if host.error.is_some() {
                    format!("{} (unavailable)", host_id)
                } else {
                    host_id.clone()
                };
                form = form.child(
                    Button::new(format!("create-host-{host_id}"))
                        .ghost()
                        .label(label)
                        .disabled(self.create_busy || host.error.is_some())
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.create_host = host_id.clone();
                            this.create_workspace = None;
                            this.create_error = None;
                            cx.notify();
                        })),
                );
            }
            form = form
                .child(
                    div()
                        .text_sm()
                        .child(format!("Selected host: {}", self.create_host)),
                )
                .child(div().child(if mode == CreateMode::Workspace {
                    "Project name"
                } else {
                    "Session title"
                }))
                .child(Input::new(&self.name_input).disabled(self.create_busy));
            if mode == CreateMode::Workspace {
                form = form.child(
                    Button::new("virtual-workspace")
                        .ghost()
                        .label(if self.virtual_workspace {
                            "Virtual project (on)"
                        } else {
                            "Virtual project (off)"
                        })
                        .disabled(self.create_busy)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.virtual_workspace = !this.virtual_workspace;
                            cx.notify();
                        })),
                );
                if !self.virtual_workspace {
                    form = form
                        .child(div().child("Folder path on selected host"))
                        .child(Input::new(&self.path_input).disabled(self.create_busy));
                }
            } else {
                form = form
                    .child(div().child("Select project"))
                    .child(Input::new(&self.workspace_search));
                let query = self.workspace_search.read(cx).value().trim().to_lowercase();
                if let Some(host) = self
                    .hosts
                    .hosts
                    .iter()
                    .find(|host| host.address.id == self.create_host)
                {
                    let mut choices = div()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .max_h(px(220.))
                        .overflow_y_scrollbar();
                    for workspace in host
                        .workspaces
                        .iter()
                        .filter(|workspace| workspace.name.to_lowercase().contains(&query))
                    {
                        let id = workspace.id.clone();
                        let selected = self.create_workspace.as_deref() == Some(id.as_str());
                        choices = choices.child(
                            Button::new(format!("workspace-{id}"))
                                .ghost()
                                .label(format!(
                                    "{}{}",
                                    if selected { "✓ " } else { "" },
                                    workspace.name
                                ))
                                .disabled(self.create_busy)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.create_workspace = Some(id.clone());
                                    this.create_error = None;
                                    cx.notify();
                                })),
                        );
                    }
                    form = form.child(choices);
                }
            }
            if let Some(error) = &self.create_error {
                form = form.child(div().text_sm().child(error.clone()));
            }
            form = form.child(
                div()
                    .flex()
                    .gap_2()
                    .child(
                        Button::new("create-submit")
                            .label(if self.create_busy {
                                "Creating..."
                            } else {
                                "Create"
                            })
                            .disabled(self.create_busy)
                            .on_click(cx.listener(|this, _, _, cx| this.submit_create(cx))),
                    )
                    .child(
                        Button::new("create-cancel")
                            .ghost()
                            .label("Cancel")
                            .disabled(self.create_busy)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.create_mode = None;
                                cx.notify();
                            })),
                    ),
            );
            return div()
                .flex()
                .size_full()
                .bg(theme.background)
                .text_color(theme.foreground)
                .child(navigation)
                .child(form);
        }

        let title = self
            .selected
            .as_ref()
            .and_then(|(host, session)| self.hosts.session(host, session))
            .map(|session| session.title.as_str())
            .unwrap_or("Choose a session");
        let mut content = div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .h_full()
            .overflow_y_scrollbar()
            .p_5()
            .gap_3()
            .child(div().text_lg().child(title.to_string()));
        if let Some(error) = &self.transcript_error {
            content = content.child(div().child(format!("Transcript unavailable: {error}")));
        }
        let page_count = self.transcript.len().div_ceil(TRANSCRIPT_PAGE_SIZE).max(1);
        let transcript_page = self.transcript_page.min(page_count - 1);
        content = content.child(
            div()
                .flex()
                .gap_2()
                .child(
                    Button::new("older-messages")
                        .ghost()
                        .label("Older messages")
                        .disabled(transcript_page + 1 >= page_count)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.transcript_page += 1;
                            cx.notify();
                        })),
                )
                .child(
                    Button::new("newer-messages")
                        .ghost()
                        .label("Newer messages")
                        .disabled(transcript_page == 0)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.transcript_page = this.transcript_page.saturating_sub(1);
                            cx.notify();
                        })),
                ),
        );
        for row in &self.transcript[transcript_page_range(self.transcript.len(), transcript_page)] {
            let text = row.text();
            if text.is_empty() {
                continue;
            }
            content = content.child(
                div()
                    .flex()
                    .flex_col()
                    .p_3()
                    .gap_1()
                    .border_1()
                    .border_color(theme.border)
                    .child(
                        div()
                            .text_xs()
                            .text_color(theme.muted_foreground)
                            .child(row.message.role.clone()),
                    )
                    .child(text),
            );
        }
        if let Some(notice) = &self.notice {
            content = content.child(div().text_sm().child(notice.clone()));
        }
        content = content.child(
            div()
                .text_xs()
                .text_color(theme.muted_foreground)
                .child("Approvals are not supported here. Use the web client for tool requests."),
        );
        let composer = div()
            .flex()
            .flex_col()
            .p_3()
            .gap_2()
            .child(
                Textarea::new(&self.composer)
                    .h(px(90.))
                    .aria_label("Message"),
            )
            .child(
                div()
                    .flex()
                    .gap_2()
                    .child(
                        Button::new("send")
                            .label("Send")
                            .disabled(!self.can_send)
                            .on_click(
                                cx.listener(|this, _, window, cx| this.send_message(window, cx)),
                            ),
                    )
                    .child(
                        Button::new("interrupt")
                            .label("Interrupt")
                            .disabled(!self.can_send)
                            .on_click(cx.listener(|this, _, _, cx| this.interrupt(cx))),
                    ),
            );

        div()
            .flex()
            .size_full()
            .bg(theme.background)
            .text_color(theme.foreground)
            .child(navigation)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .child(content)
                    .child(composer),
            )
    }
}

#[cfg(test)]
mod paging_tests {
    use super::*;

    #[test]
    fn transcript_pages_cover_all_rows_without_overlap() {
        assert_eq!(transcript_page_range(0, 0), 0..0);
        assert_eq!(transcript_page_range(25, 0), 15..25);
        assert_eq!(transcript_page_range(25, 1), 5..15);
        assert_eq!(transcript_page_range(25, 2), 0..5);
        assert_eq!(transcript_page_range(25, usize::MAX), 0..0);
    }
}

fn main() {
    // The local address may start a known bundled daemon after identity and data-root checks.
    let local_url = std::env::var("PROKOP_DESKTOP_LOCAL_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8742".into());
    let mut local = HostAddress::new(
        "This machine",
        local_url,
        std::env::var("PROKOPAI_AUTH_TOKEN").ok(),
    )
    .expect("Invalid local host URL");
    local.local = true;
    let mut hosts = vec![local];
    if let Ok(remote) = std::env::var("PROKOP_DESKTOP_REMOTE_URL") {
        hosts.push(HostAddress::new("Remote", remote, None).expect("Invalid remote host URL"));
    }
    gpui_kit::application()
        .with_assets(gpui_kit::assets::Assets)
        .run(move |cx| {
            gpui_kit::init(cx);
            cx.spawn(async move |cx| {
                cx.open_window(WindowOptions::default(), |window, cx| {
                    let view = cx.new(|cx| {
                        let composer = cx.new(|cx| {
                            TextareaState::new(window, cx).placeholder("Write a message")
                        });
                        let session_list = cx.new(|cx| {
                            ListState::new(SessionListDelegate::new(), window, cx).searchable(true)
                        });
                        let list_subscription = cx.subscribe_in(
                            &session_list,
                            window,
                            |this: &mut Desktop, list, event: &ListEvent, window, cx| {
                                if let ListEvent::Confirm(ix) = event {
                                    let selected =
                                        list.read(cx).delegate().entry(*ix).map(|entry| {
                                            (entry.host_id.clone(), entry.session_id.clone())
                                        });
                                    if let Some((host_id, session_id)) = selected {
                                        this.open_session(host_id, session_id, window, cx);
                                    }
                                }
                            },
                        );
                        let name_input =
                            cx.new(|cx| InputState::new(window, cx).placeholder("Name"));
                        let path_input =
                            cx.new(|cx| InputState::new(window, cx).placeholder("/path/on/host"));
                        let workspace_search =
                            cx.new(|cx| InputState::new(window, cx).placeholder("Find a project"));
                        let search_subscription = cx.subscribe_in(
                            &workspace_search,
                            window,
                            |_this: &mut Desktop, _, event: &InputEvent, _, cx| {
                                if matches!(event, InputEvent::Change) {
                                    cx.notify();
                                }
                            },
                        );
                        let mut desktop = Desktop::new(
                            hosts,
                            composer,
                            session_list,
                            list_subscription,
                            name_input,
                            path_input,
                            workspace_search,
                            search_subscription,
                        );
                        desktop.refresh(cx);
                        desktop
                    });
                    cx.new(|cx| Root::new(view, window, cx))
                })
                .expect("Failed to open Prokop window");
            })
            .detach();
        });
}
