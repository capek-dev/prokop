use gpui_kit::component::{
    ActiveTheme, IndexPath,
    list::{ListDelegate, ListItem, ListState},
};
use gpui_kit::{App, Context, IntoElement, ParentElement as _, Styled as _, Task, Window, div};

use crate::host::HostIndex;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionEntry {
    pub host_id: String,
    pub session_id: String,
    pub workspace_name: String,
    pub title: String,
}

pub struct SessionListDelegate {
    entries: Vec<SessionEntry>,
    visible: Vec<usize>,
    query: String,
    selected: Option<IndexPath>,
}

impl SessionListDelegate {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            visible: Vec::new(),
            query: String::new(),
            selected: None,
        }
    }

    pub fn update(&mut self, hosts: &HostIndex) {
        self.entries = hosts
            .hosts
            .iter()
            .flat_map(|host| {
                host.sessions.iter().filter_map(|session| {
                    let workspace = host
                        .workspaces
                        .iter()
                        .find(|workspace| workspace.id == session.workspace_id)?;
                    Some(SessionEntry {
                        host_id: host.address.id.clone(),
                        session_id: session.id.clone(),
                        workspace_name: workspace.name.clone(),
                        title: session.title.clone(),
                    })
                })
            })
            .collect();
        self.filter();
    }

    fn filter(&mut self) {
        let query = self.query.trim().to_lowercase();
        self.visible = self
            .entries
            .iter()
            .enumerate()
            .filter_map(|(ix, entry)| {
                (query.is_empty()
                    || entry.title.to_lowercase().contains(&query)
                    || entry.workspace_name.to_lowercase().contains(&query)
                    || entry.host_id.to_lowercase().contains(&query))
                .then_some(ix)
            })
            .collect();
        self.selected = None;
    }

    pub fn entry(&self, ix: IndexPath) -> Option<&SessionEntry> {
        self.entries.get(*self.visible.get(ix.row)?)
    }

    pub fn count(&self) -> usize {
        self.visible.len()
    }
}

impl ListDelegate for SessionListDelegate {
    type Item = ListItem;

    fn items_count(&self, _section: usize, _cx: &App) -> usize {
        self.count()
    }

    fn render_item(
        &mut self,
        ix: IndexPath,
        _window: &mut Window,
        cx: &mut Context<ListState<Self>>,
    ) -> Option<Self::Item> {
        let entry = self.entry(ix)?;
        Some(
            ListItem::new(format!("session:{}:{}", entry.host_id, entry.session_id))
                .h_12()
                .overflow_hidden()
                .selected(self.selected == Some(ix))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .min_w_0()
                        .child(entry.title.clone())
                        .child(
                            div()
                                .text_xs()
                                .text_color(cx.theme().muted_foreground)
                                .child(format!("{} / {}", entry.host_id, entry.workspace_name)),
                        ),
                ),
        )
    }

    fn set_selected_index(
        &mut self,
        ix: Option<IndexPath>,
        _window: &mut Window,
        cx: &mut Context<ListState<Self>>,
    ) {
        self.selected = ix;
        cx.notify();
    }

    fn perform_search(
        &mut self,
        query: &str,
        _window: &mut Window,
        cx: &mut Context<ListState<Self>>,
    ) -> Task<()> {
        self.query = query.to_string();
        self.filter();
        cx.notify();
        Task::ready(())
    }

    fn render_empty(
        &mut self,
        _window: &mut Window,
        cx: &mut Context<ListState<Self>>,
    ) -> impl IntoElement {
        div()
            .p_3()
            .text_sm()
            .text_color(cx.theme().muted_foreground)
            .child("No matching sessions")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::{HostAddress, HostSnapshot, Session, Workspace};

    #[test]
    fn search_preserves_all_sessions_and_host_identity() {
        let mut hosts = HostIndex::default();
        for (id, name) in [("local", "Project"), ("remote", "Remote project")] {
            let mut host =
                HostSnapshot::pending(HostAddress::new(id, "https://example.com", None).unwrap());
            host.workspaces.push(Workspace {
                id: "w".into(),
                name: name.into(),
            });
            for ix in 0..120 {
                host.sessions.push(Session {
                    id: format!("session-{ix}"),
                    workspace_id: "w".into(),
                    title: format!("Chat {ix}"),
                });
            }
            hosts.hosts.push(host);
        }
        let mut delegate = SessionListDelegate::new();
        delegate.update(&hosts);
        assert_eq!(delegate.count(), 240);
        assert_eq!(
            delegate.entry(IndexPath::new(119)).unwrap().host_id,
            "local"
        );
        assert_eq!(
            delegate.entry(IndexPath::new(120)).unwrap().host_id,
            "remote"
        );
        delegate.query = "remote project".into();
        delegate.filter();
        assert_eq!(delegate.count(), 120);
        assert_eq!(delegate.entry(IndexPath::new(0)).unwrap().host_id, "remote");
        delegate.update(&hosts);
        assert_eq!(
            delegate.count(),
            120,
            "refresh must preserve the active search"
        );
        delegate.query = "missing".into();
        delegate.filter();
        assert_eq!(delegate.count(), 0);
    }
}
