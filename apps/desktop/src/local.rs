use std::{
    fs,
    io::ErrorKind,
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use crate::host::HostAddress;

const ID_FILE: &str = "installation-id";
const DEADLINE: Duration = Duration::from_secs(8);
static START_LOCK: Mutex<()> = Mutex::new(());

fn data_dir() -> Result<PathBuf, String> {
    if let Some(path) =
        std::env::var_os("PROKOPAI_DATA_DIR").or_else(|| std::env::var_os("JEAN2_DATA_DIR"))
    {
        return Ok(PathBuf::from(path));
    }
    let home = PathBuf::from(std::env::var_os("HOME").ok_or("HOME is not set")?);
    let canonical = home.join(".prokopai");
    if canonical.is_dir() {
        Ok(canonical)
    } else if home.join(".jean2").is_dir() {
        Ok(home.join(".jean2"))
    } else {
        Ok(canonical)
    }
}

fn read_id(root: &Path) -> Result<String, String> {
    let path = root.join(ID_FILE);
    let meta = fs::symlink_metadata(&path).map_err(|_| {
        "Local host has no installation ID. Upgrade the host before attaching.".to_string()
    })?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err("Local installation ID file is not a regular file".into());
    }
    let id = fs::read_to_string(path).map_err(|_| "Cannot read the local installation ID")?;
    let id = id.trim();
    let sections: Vec<&str> = id.split('-').collect();
    if sections.len() != 5
        || sections
            .iter()
            .zip([8, 4, 4, 4, 12])
            .any(|(s, n)| s.len() != n || !s.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err("Invalid local installation ID".into());
    }
    Ok(id.to_string())
}

pub fn existing_installation_id() -> Result<String, String> {
    read_id(&data_dir()?)
}

#[derive(PartialEq, Eq, Debug)]
enum Reachability {
    Listening,
    Refused,
    Unsafe,
}

fn decide(responses: &[Result<(), ErrorKind>]) -> Reachability {
    if responses.iter().any(Result::is_ok) {
        Reachability::Listening
    } else if responses
        .iter()
        .all(|r| matches!(r, Err(ErrorKind::ConnectionRefused)))
    {
        Reachability::Refused
    } else {
        Reachability::Unsafe
    }
}

fn reachability(url: &url::Url) -> Reachability {
    let Some(host) = url.host_str() else {
        return Reachability::Unsafe;
    };
    let Some(port) = url.port_or_known_default() else {
        return Reachability::Unsafe;
    };
    let Ok(addresses) = (host, port).to_socket_addrs() else {
        return Reachability::Unsafe;
    };
    let responses: Vec<_> = addresses
        .map(|address| {
            TcpStream::connect_timeout(&address, Duration::from_millis(500))
                .map(|_| ())
                .map_err(|e| e.kind())
        })
        .collect();
    if responses.is_empty() {
        Reachability::Unsafe
    } else {
        decide(&responses)
    }
}

fn unsafe_launch_settings(env: &str, process_value: impl Fn(&str) -> Option<String>) -> bool {
    let file_value = |key: &str| {
        env.lines()
            .filter_map(|line| {
                let line = line.trim();
                if line.starts_with('#') {
                    return None;
                }
                let (name, value) = line.split_once('=')?;
                (name.trim() == key).then(|| value.trim().trim_matches(['\'', '"']).to_string())
            })
            .last()
    };
    let value = |key: &str| process_value(key).or_else(|| file_value(key));
    if ["PROKOPAI_DATABASE_PATH", "JEAN2_DATABASE_PATH"]
        .iter()
        .any(|key| value(key).is_some())
    {
        return true;
    }
    // The host resolves the canonical name before the legacy one. A literal
    // false disables TLS even when the legacy variable is still true.
    value("PROKOPAI_TLS_ENABLED")
        .or_else(|| value("JEAN2_TLS_ENABLED"))
        .as_deref()
        == Some("true")
}

fn safe_data_root(root: &Path) -> Result<(), String> {
    let config = fs::read_to_string(root.join("config.json"))
        .map_err(|_| "Prokop is not initialized in this data root. Initialize it before launching the desktop.".to_string())?;
    let config: serde_json::Value = serde_json::from_str(&config)
        .map_err(|_| "Invalid Prokop configuration; start the host manually.".to_string())?;
    let default_db = root.join("data/agent.db");
    let configured = config
        .get("databasePath")
        .and_then(serde_json::Value::as_str);
    if configured.is_some_and(|path| Path::new(path) != default_db) {
        return Err("Custom database path detected; start the host manually to avoid opening the wrong data.".into());
    }
    let env = match fs::read_to_string(root.join(".env")) {
        Ok(contents) => contents,
        Err(error) if error.kind() == ErrorKind::NotFound => String::new(),
        Err(_) => {
            return Err("Cannot inspect the Prokop environment; start the host manually.".into());
        }
    };
    if unsafe_launch_settings(&env, |key| std::env::var(key).ok()) {
        return Err("Database override or TLS enabled; start the host manually to avoid opening the wrong data or listener.".into());
    }
    if !default_db.is_file() {
        return Err(
            "Local database is missing; initialize Prokop before launching the desktop.".into(),
        );
    }
    Ok(())
}

pub fn prepare(address: &HostAddress) -> Result<(), String> {
    // Refreshes can overlap; only one caller may decide to launch a local host.
    let _guard = START_LOCK
        .lock()
        .map_err(|_| "Local host start lock is unavailable")?;
    let url = url::Url::parse(&address.url).map_err(|_| "Invalid local host URL")?;
    if url.scheme() != "http"
        || !matches!(
            url.host_str(),
            Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
        )
    {
        return Err("Automatic host launch requires a loopback HTTP origin".into());
    }
    let root = data_dir()?;
    match reachability(&url) {
        Reachability::Listening => return address.probe(),
        Reachability::Unsafe => {
            return Err(
                "Cannot safely determine whether the local port is in use; no host was started."
                    .into(),
            );
        }
        Reachability::Refused => {}
    }
    safe_data_root(&root)?;
    let bin = std::env::current_exe()
        .map_err(|_| "Cannot locate the desktop executable")?
        .parent()
        .ok_or("Cannot locate desktop binary directory")?
        .join("prokop");
    if !bin.is_file() {
        return Err("Bundled Prokop host binary is missing beside the desktop executable.".into());
    }
    let version = Command::new(&bin)
        .arg("version")
        .output()
        .map_err(|_| "Bundled Prokop host binary cannot be executed")?;
    if !version.status.success()
        || !String::from_utf8_lossy(&version.stdout)
            .lines()
            .any(|line| line.starts_with("prokop version "))
    {
        return Err("Bundled Prokop host binary is incompatible; no host was started.".into());
    }
    // Recheck before spawn: a newly occupied port is never permission to take over a process.
    if reachability(&url) != Reachability::Refused {
        return Err("Local port changed during startup; no host was started.".into());
    }
    let status = Command::new(bin)
        .arg("start")
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(url.port_or_known_default().unwrap().to_string())
        .env("PROKOPAI_DATA_DIR", &root)
        .env("JEAN2_DATA_DIR", &root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "Failed to launch the bundled Prokop host")?;
    if !status.success() {
        return Err(
            "Bundled host could not start. Check its log in the Prokop data directory.".into(),
        );
    }
    let deadline = Instant::now() + DEADLINE;
    loop {
        match reachability(&url) {
            Reachability::Listening => return address.probe(),
            Reachability::Unsafe => {
                return Err("Host readiness check failed. Check the host log.".into());
            }
            Reachability::Refused if Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(200))
            }
            Reachability::Refused => {
                return Err("Host did not become ready. Check the host log.".into());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_a_refused_port_allows_start() {
        assert_eq!(
            decide(&[Err(ErrorKind::ConnectionRefused)]),
            Reachability::Refused
        );
        assert_eq!(
            decide(&[Ok(()), Err(ErrorKind::ConnectionRefused)]),
            Reachability::Listening
        );
        assert_eq!(decide(&[Err(ErrorKind::TimedOut)]), Reachability::Unsafe);
    }
    #[test]
    fn effective_tls_false_allows_launch_but_true_and_database_overrides_block_it() {
        let absent = |_key: &str| None;
        assert!(!unsafe_launch_settings("JEAN2_TLS_ENABLED=false", absent));
        assert!(unsafe_launch_settings("JEAN2_TLS_ENABLED=true", absent));
        assert!(!unsafe_launch_settings("JEAN2_TLS_ENABLED=true", |key| {
            (key == "PROKOPAI_TLS_ENABLED").then(|| "false".to_string())
        }));
        assert!(unsafe_launch_settings(
            "# PROKOPAI_DATABASE_PATH=/ignored\nJEAN2_DATABASE_PATH=/other",
            absent
        ));
        assert!(!unsafe_launch_settings(
            "# PROKOPAI_DATABASE_PATH=/ignored",
            absent
        ));
    }

    #[test]
    fn legacy_and_custom_database_paths_do_not_become_an_empty_store() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "prokop-local-fixture-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&root).unwrap();
        assert!(read_id(&root).is_err());
        assert!(safe_data_root(&root).is_err());
        fs::write(
            root.join("installation-id"),
            "550e8400-e29b-41d4-a716-446655440000",
        )
        .unwrap();
        assert!(read_id(&root).is_ok());
        fs::write(
            root.join("config.json"),
            r#"{"databasePath":"/wrong/agent.db"}"#,
        )
        .unwrap();
        assert!(
            safe_data_root(&root)
                .unwrap_err()
                .contains("Custom database path")
        );
        fs::remove_dir_all(root).unwrap();
    }
}
