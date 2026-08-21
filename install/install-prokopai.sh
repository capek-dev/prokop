#!/usr/bin/env bash

set -euo pipefail

VERSION_FILE_URL="https://raw.githubusercontent.com/jean2ai/jean2/refs/heads/main/packages/server/VERSION"
REPO="jean2ai/jean2"
INSTALL_DIR="${HOME}/.jean2/bin"
BINARY_NAME="jean2"
BINARY_PATH=""

FORCE=false
SKIP_PATH=false
CUSTOM_VERSION=""
CUSTOM_INSTALL_DIR=""
SHELL_CONFIG_FILE=""

TEMP_FILE=""

cleanup() {
  if [[ -n "${TEMP_FILE:-}" && -f "$TEMP_FILE" ]]; then
    rm -f "$TEMP_FILE"
  fi
}
trap cleanup EXIT

supports_color() {
  if [[ -z "${FORCE_COLOR:-}" ]] && [[ -t 1 ]]; then
    if command -v tput &>/dev/null && tput colors &>/dev/null; then
      [[ $(tput colors) -ge 8 ]]
    else
      [[ "${TERM:-}" == *color* ]] || [[ "${TERM:-}" == *xterm* ]] || [[ "${TERM:-}" == *screen* ]]
    fi
  else
    [[ "${FORCE_COLOR:-}" == "1" ]]
  fi
}

if supports_color; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'
  NC='\033[0m'
else
  RED=""
  GREEN=""
  YELLOW=""
  CYAN=""
  NC=""
fi

error() {
  echo -e "${RED}error${NC}: $*" >&2
  exit 1
}

warn() {
  echo -e "${YELLOW}warning${NC}: $*" >&2
}

info() {
  echo -e "${CYAN}info${NC}: $*" >&2
}

success() {
  echo -e "${GREEN}${*}${NC}" >&2
}

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Install or update Jean2 server binary from GitHub Releases.

OPTIONS:
  --version <ver>      Install a specific version (default: latest)
  --install-dir <path>  Install to custom directory (default: ~/.jean2/bin)
  --force              Reinstall/update even if same version
  --no-path            Skip adding to PATH
  --help               Show this help message

BEHAVIOR:
  Fresh install: Downloads binary and configures PATH. Does not auto-start.
  Update: Stops running daemon, replaces binary, runs migrations, restarts.

EXAMPLES:
  $(basename "$0")                     # Install latest version
  $(basename "$0") --version 0.4.5     # Install specific version
  $(basename "$0") --force             # Reinstall/update current version
  $(basename "$0") --no-path           # Install without modifying PATH

EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version)
        [[ $# -ge 2 ]] || error "--version requires an argument"
        CUSTOM_VERSION="$2"
        shift 2
        ;;
      --install-dir)
        [[ $# -ge 2 ]] || error "--install-dir requires an argument"
        CUSTOM_INSTALL_DIR="$2"
        shift 2
        ;;
      --force)
        FORCE=true
        shift
        ;;
      --no-path)
        SKIP_PATH=true
        shift
        ;;
      --help)
        usage
        exit 0
        ;;
      *)
        error "Unknown option: $1"
        ;;
    esac
  done

  if [[ -n "${CUSTOM_INSTALL_DIR:-}" ]]; then
    INSTALL_DIR="$CUSTOM_INSTALL_DIR"
  fi
}

detect_os() {
  local os
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"

  case "$os" in
    darwin*)
      echo "darwin"
      ;;
    linux*)
      echo "linux"
      ;;
    *)
      error "Unsupported OS: $os. Only darwin and linux are supported."
      ;;
  esac
}

fetch_version() {
  local version
  info "Fetching latest version from VERSION file..."

  if ! version=$(curl -fsSL "$VERSION_FILE_URL" 2>/dev/null); then
    error "Failed to fetch VERSION file from GitHub. Please specify --version explicitly."
  fi

  version="${version//$'\r'/}"
  version="${version#\"${version%%[![:space:]]*}\"}"
  version="${version%\"${version##*[![:space:]]}\"}"

  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    error "Invalid version format from VERSION file: '$version'"
  fi

  echo "$version"
}

check_existing_install() {
  local current_version
  current_version=$("$BINARY_PATH" --version 2>/dev/null | head -n1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
  echo "$current_version"
}

is_jean2_running() {
  local status_output
  status_output=$("$BINARY_PATH" status 2>&1 || true)
  
  if echo "$status_output" | grep -q "Daemon is running"; then
    return 0
  else
    return 1
  fi
}

stop_jean2() {
  info "Stopping Jean2 daemon..."
  
  if ! "$BINARY_PATH" stop 2>&1; then
    error "Failed to stop Jean2 daemon. Update aborted."
  fi
  
  sleep 1
  
  if is_jean2_running; then
    error "Jean2 daemon is still running after stop command. Update aborted."
  fi
  
  success "Jean2 daemon stopped"
}

is_initialized() {
  local migrate_output
  migrate_output=$("$BINARY_PATH" migrate 2>&1 || true)
  
  if echo "$migrate_output" | grep -q "not initialized"; then
    return 1
  fi
  return 0
}

run_migrations() {
  local new_binary="$1"
  
  info "Running database migrations with new binary..."
  
  if ! "$new_binary" migrate 2>&1; then
    error "Migration failed. Update aborted. Your old binary is still in place."
  fi
  
  success "Migrations completed successfully"
}

start_jean2() {
  local new_binary="$1"
  
  info "Starting Jean2 daemon..."
  
  if ! "$new_binary" start 2>&1; then
    error "Failed to start Jean2 daemon after update."
  fi
  
  sleep 1
  
  if is_jean2_running_with_binary "$new_binary"; then
    success "Jean2 daemon started successfully"
  else
    warn "Jean2 daemon may not have started correctly"
  fi
}

is_jean2_running_with_binary() {
  local binary="$1"
  local status_output
  status_output=$("$binary" status 2>&1 || true)
  
  if echo "$status_output" | grep -q "Daemon is running"; then
    return 0
  else
    return 1
  fi
}

download_binary() {
  local url="https://github.com/${REPO}/releases/download/server%2Fv${VERSION}/jean2-${OS}"

  info "Downloading Jean2 for $OS..."
  info "URL: $url"

  TEMP_FILE=$(mktemp)

  if ! curl -fSL --progress-bar -o "$TEMP_FILE" "$url"; then
    error "Download failed"
  fi

  success "Download complete"
  echo "$TEMP_FILE"
}

install_binary() {
  local file="$1"

  info "Installing to $BINARY_PATH..."

  mkdir -p "$(dirname "$BINARY_PATH")"

  if ! mv -f "$file" "$BINARY_PATH"; then
    error "Failed to install binary to $BINARY_PATH"
  fi

  if ! chmod +x "$BINARY_PATH"; then
    warn "Failed to make binary executable"
  fi

  success "Installed to $BINARY_PATH"
}

configure_path() {
  if [[ "$SKIP_PATH" == true ]]; then
    info "Skipping PATH configuration (--no-path specified)"
    return 0
  fi

  local shell_config=""
  local path_line="export PATH=\"${INSTALL_DIR}:\$PATH\""

  case "${SHELL:-}" in
    *zsh*)
      if [[ -f "$HOME/.zshrc" ]]; then
        shell_config="$HOME/.zshrc"
      fi
      ;;
    *bash*)
      if [[ -f "$HOME/.bashrc" ]]; then
        shell_config="$HOME/.bashrc"
      elif [[ -f "$HOME/.bash_profile" ]]; then
        shell_config="$HOME/.bash_profile"
      fi
      ;;
  esac

  if [[ -z "$shell_config" ]]; then
    if [[ -f "$HOME/.zshrc" ]]; then
      shell_config="$HOME/.zshrc"
    elif [[ -f "$HOME/.bashrc" ]]; then
      shell_config="$HOME/.bashrc"
    elif [[ -f "$HOME/.bash_profile" ]]; then
      shell_config="$HOME/.bash_profile"
    elif [[ -f "$HOME/.profile" ]]; then
      shell_config="$HOME/.profile"
    fi
  fi

  SHELL_CONFIG_FILE="$shell_config"

  if [[ -z "$shell_config" ]]; then
    warn "No shell config file found. Manually add the following to your PATH:"
    info "$path_line"
    return 0
  fi

  if grep -qF "$INSTALL_DIR" "$shell_config" 2>/dev/null; then
    info "PATH already configured in $shell_config"
    return 0
  fi

  info "Adding Jean2 to PATH in $shell_config..."

  {
    echo ""
    echo "$path_line"
  } >> "$shell_config" && success "Added Jean2 to PATH in $shell_config" || warn "Failed to update $shell_config"
}

update_existing_install() {
  local was_running=false
  local needs_migration=false
  
  info "Jean2 is already installed at $BINARY_PATH"
  
  local current_version
  current_version=$(check_existing_install)
  info "Current version: $current_version"
  info "Target version: $VERSION"
  
  if [[ "$current_version" == "$VERSION" ]] && [[ "$FORCE" != true ]]; then
    info "Already on version $VERSION. Use --force to update anyway."
    exit 0
  fi
  
  info "Checking if Jean2 daemon is running..."
  if is_jean2_running; then
    was_running=true
    info "Jean2 daemon is running"
    stop_jean2
  else
    info "Jean2 daemon is not running"
  fi
  
  info "Checking if Jean2 is initialized..."
  if is_initialized; then
    needs_migration=true
    info "Jean2 is initialized, will run migrations"
  else
    info "Jean2 is not initialized, skipping migrations"
  fi
  
  local temp_file
  temp_file=$(download_binary)
  
  install_binary "$temp_file"
  
  local new_binary="$BINARY_PATH"
  
  if [[ "$needs_migration" == true ]]; then
    run_migrations "$new_binary"
  fi
  
  if [[ "$was_running" == true ]]; then
    start_jean2 "$new_binary"
  else
    info "Jean2 was not running before update, not starting"
  fi
  
  success "Jean2 updated from v${current_version} to v${VERSION}"
}

main() {
  parse_args "$@"

  OS=$(detect_os)

  if [[ -n "$CUSTOM_VERSION" ]]; then
    VERSION="$CUSTOM_VERSION"
    info "Using specified version: $VERSION"
  else
    VERSION=$(fetch_version)
    info "Using latest version: $VERSION"
  fi

  BINARY_PATH="${INSTALL_DIR}/${BINARY_NAME}"

  if [[ -f "$BINARY_PATH" ]]; then
    update_existing_install
  else
    if [[ "$FORCE" == true ]]; then
      warn "--force specified but no existing installation found, proceeding with fresh install"
    fi
    info "Fresh installation at $BINARY_PATH"
    
    local temp_file
    temp_file=$(download_binary)
    
    install_binary "$temp_file"
    
    configure_path
    
    echo ""
    success "Jean2 v${VERSION} installed successfully!"
    echo ""
    info "Binary location: $BINARY_PATH"
    echo ""
    
    if [[ "$SKIP_PATH" != true ]]; then
      echo "  Next steps:"
      echo "    1. Restart your terminal or run:"
      if [[ -n "${SHELL_CONFIG_FILE:-}" ]]; then
        echo -e "       source \"${SHELL_CONFIG_FILE}\""
      else
        echo -e "       export PATH=\"${INSTALL_DIR}:\$PATH\""
      fi
      echo -e "    2. Initialize: ${CYAN}${BINARY_PATH} init${NC}"
      echo -e "    3. Start:      ${CYAN}${BINARY_PATH} start${NC}"
    else
      echo "  Next steps:"
      echo "    1. Add to PATH: export PATH=\"$INSTALL_DIR:\$PATH\""
      echo -e "    2. Initialize: ${CYAN}${BINARY_PATH} init${NC}"
      echo -e "    3. Start:      ${CYAN}${BINARY_PATH} start${NC}"
    fi
    echo ""
  fi
  
  configure_path
}

main "$@"
