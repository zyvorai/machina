// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

//! `machina-agent join` receives the fleet's shared agent token from the controller (answering a
//! valid single-use enrollment token) and stores it, so adding a host is one command with no
//! secret copied by hand.

use std::path::Path;

/// Default file the packaged services read their environment from.
pub const DEFAULT_ENV_FILE: &str = "/etc/default/machina-platform";

/// True when the join URL protects the token on the wire: https, or a loopback host (an SSH
/// tunnel or the controller on the same machine).
pub fn channel_is_safe(controller: &str) -> bool {
    if controller.starts_with("https://") {
        return true;
    }
    let Some(rest) = controller.strip_prefix("http://") else {
        return false;
    };
    let host = rest.split(['/', '?']).next().unwrap_or("");
    let host = if let Some(v6) = host.strip_prefix('[') {
        v6.split(']').next().unwrap_or("")
    } else {
        host.split(':').next().unwrap_or("")
    };
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

/// A token is stored only if it is a single printable word, so it can never inject another line
/// into the environment file.
pub fn token_is_valid(token: &str) -> bool {
    !token.is_empty() && token.len() <= 512 && token.bytes().all(|b| b.is_ascii_graphic())
}

/// Replaces (or appends) `MACHINA_AGENT_TOKEN=` in `path` and leaves the file mode 0600.
/// Returns true when the file changed. The old file is kept next to it as `<name>.bak-pre-join`.
pub fn store_agent_token(path: &Path, token: &str) -> std::io::Result<bool> {
    if !token_is_valid(token) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "agent token is empty or has characters not allowed in an environment file",
        ));
    }
    let old = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e),
    };
    let wanted = format!("MACHINA_AGENT_TOKEN={token}");
    if old.lines().any(|l| l == wanted) {
        return Ok(false);
    }
    let mut out: String = old
        .lines()
        .filter(|l| !l.starts_with("MACHINA_AGENT_TOKEN="))
        .map(|l| format!("{l}\n"))
        .collect();
    out.push_str(&wanted);
    out.push('\n');
    if !old.is_empty() {
        let mut bak = path.as_os_str().to_owned();
        bak.push(".bak-pre-join");
        std::fs::write(&bak, &old)?;
        set_private(Path::new(&bak))?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".join-tmp");
    let tmp = std::path::PathBuf::from(tmp);
    std::fs::write(&tmp, out)?;
    set_private(&tmp)?;
    std::fs::rename(&tmp, path)?;
    Ok(true)
}

#[cfg(unix)]
fn set_private(p: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o600))
}
#[cfg(not(unix))]
fn set_private(_: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_or_loopback_carry_the_token() {
        assert!(channel_is_safe("https://ctl.example:5093"));
        assert!(channel_is_safe("http://127.0.0.1:15093"));
        assert!(channel_is_safe("http://localhost:5093/x"));
        assert!(channel_is_safe("http://[::1]:5093"));
        assert!(!channel_is_safe("http://10.0.0.5:5093"));
        assert!(!channel_is_safe("http://127.0.0.1.evil.example"));
        assert!(!channel_is_safe("ctl:5093"));
    }

    #[test]
    fn rejects_values_that_could_add_lines() {
        assert!(!token_is_valid(""));
        assert!(!token_is_valid("a\nB=1"));
        assert!(!token_is_valid("a b"));
        assert!(token_is_valid("0123abcDEF-_=="));
    }

    #[test]
    fn replaces_the_line_keeps_the_rest_and_the_mode() {
        let d = std::env::temp_dir().join(format!("machina-enrol-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("platform");
        std::fs::write(&f, "A=1\nMACHINA_AGENT_TOKEN=old\nB=2\n").unwrap();
        assert!(store_agent_token(&f, "new").unwrap());
        assert_eq!(
            std::fs::read_to_string(&f).unwrap(),
            "A=1\nB=2\nMACHINA_AGENT_TOKEN=new\n"
        );
        assert!(!store_agent_token(&f, "new").unwrap());
        assert_eq!(
            std::fs::read_to_string(d.join("platform.bak-pre-join")).unwrap(),
            "A=1\nMACHINA_AGENT_TOKEN=old\nB=2\n"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&f).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert!(store_agent_token(&f, "bad\nX=1").is_err());
        let _ = std::fs::remove_dir_all(&d);
    }
}
