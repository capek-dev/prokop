Set-StrictMode -Version Latest

$VERSION_FILE_URL = "https://raw.githubusercontent.com/jean2ai/jean2/refs/heads/main/packages/server/VERSION"
$REPO = "jean2ai/jean2"
$INSTALL_DIR = "$HOME\.jean2\bin"
$BINARY_NAME = "jean2.exe"
$BINARY_PATH = ""

$Force = $false
$SkipPath = $false
$CustomVersion = ""
$CustomInstallDir = ""

$TEMP_FILE = ""

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

function cleanup {
  if ([string]::IsNullOrEmpty($TEMP_FILE) -eq $false -and (Test-Path $TEMP_FILE)) {
    Remove-Item $TEMP_FILE -Force -ErrorAction SilentlyContinue
  }
}
try {
  $originalArgs = $args

  function error {
    param([string]$Message)
    Write-Host -Object "error: $Message" -ForegroundColor Red
    exit 1
  }

  function warn {
    param([string]$Message)
    Write-Host -Object "warning: $Message" -ForegroundColor Yellow
  }

  function info {
    param([string]$Message)
    Write-Host -Object "info: $Message" -ForegroundColor Cyan
  }

  function success {
    param([string]$Message)
    Write-Host -Object $Message -ForegroundColor Green
  }

  function usage {
    @"
Install or update Jean2 server binary from GitHub Releases.

OPTIONS:
  --Version <ver>      Install a specific version (default: latest)
  --InstallDir <path>  Install to custom directory (default: ~/.jean2/bin)
  --Force              Reinstall/update even if same version
  --NoPath             Skip adding to PATH
  --Help               Show this help message

BEHAVIOR:
  Fresh install: Downloads binary and configures PATH. Does not auto-start.
  Update: Stops running daemon, replaces binary, runs migrations, restarts.

EXAMPLES:
  install-jean2.ps1                   # Install latest version
  install-jean2.ps1 --Version 0.4.5  # Install specific version
  install-jean2.ps1 --Force           # Reinstall/update current version
  install-jean2.ps1 --NoPath          # Install without modifying PATH

"@
  }

  function parse_args {
    $i = 0
    while ($i -lt $originalArgs.Count) {
      $arg = $originalArgs[$i]
      switch ($arg) {
        "--Version" {
          if ($i + 1 -ge $originalArgs.Count) { error "--Version requires an argument" }
          $script:CustomVersion = $originalArgs[$i + 1]
          $i += 2
        }
        "--InstallDir" {
          if ($i + 1 -ge $originalArgs.Count) { error "--InstallDir requires an argument" }
          $script:CustomInstallDir = $originalArgs[$i + 1]
          $i += 2
        }
        "--Force" {
          $script:Force = $true
          $i++
        }
        "--NoPath" {
          $script:SkipPath = $true
          $i++
        }
        "--Help" {
          usage
          exit 0
        }
        default {
          error "Unknown option: $arg"
        }
      }
    }

    if ([string]::IsNullOrEmpty($CustomInstallDir) -eq $false) {
      $script:INSTALL_DIR = $CustomInstallDir
    }
  }

  function fetch_version {
    info "Fetching latest version from VERSION file..."

    try {
      $version = Invoke-RestMethod -Uri $VERSION_FILE_URL -ErrorAction Stop
    } catch {
      error "Failed to fetch VERSION file from GitHub. Please specify --Version explicitly."
    }

    $version = $version.Trim().Trim('"')

    if ($version -notmatch '^\d+\.\d+\.\d+$') {
      error "Invalid version format from VERSION file: '$version'"
    }

    return $version
  }

  function check_existing_install {
    $output = & $BINARY_PATH --version 2>&1
    if ($LASTEXITCODE -ne 0) {
      return "unknown"
    }
    $firstLine = ($output | Select-Object -First 1)
    if ($firstLine -match '(\d+\.\d+\.\d+)') {
      return $matches[1]
    }
    return "unknown"
  }

  function is_jean2_running {
    $output = & $BINARY_PATH status 2>&1 | Out-String
    return $output -match "Daemon is running"
  }

  function stop_jean2 {
    info "Stopping Jean2 daemon..."

    $null = & $BINARY_PATH stop 2>&1
    if ($LASTEXITCODE -ne 0) {
      error "Failed to stop Jean2 daemon. Update aborted."
    }

    Start-Sleep -Seconds 1

    if (is_jean2_running) {
      error "Jean2 daemon is still running after stop command. Update aborted."
    }

    success "Jean2 daemon stopped"
  }

  function is_initialized {
    $output = & $BINARY_PATH migrate 2>&1 | Out-String
    return $output -notmatch "not initialized"
  }

  function run_migrations {
    param([string]$NewBinary)

    info "Running database migrations with new binary..."

    $null = & $NewBinary migrate 2>&1
    if ($LASTEXITCODE -ne 0) {
      error "Migration failed. Update aborted. Your old binary is still in place."
    }

    success "Migrations completed successfully"
  }

  function start_jean2 {
    param([string]$NewBinary)

    info "Starting Jean2 daemon..."

    $null = & $NewBinary start 2>&1
    if ($LASTEXITCODE -ne 0) {
      error "Failed to start Jean2 daemon after update."
    }

    Start-Sleep -Seconds 1

    if (is_jean2_running_with_binary $NewBinary) {
      success "Jean2 daemon started successfully"
    } else {
      warn "Jean2 daemon may not have started correctly"
    }
  }

  function is_jean2_running_with_binary {
    param([string]$Binary)
    $output = & $Binary status 2>&1 | Out-String
    return $output -match "Daemon is running"
  }

  function download_binary {
    param([string]$Version)

    $url = "https://github.com/$REPO/releases/download/server%2Fv$Version/jean2-windows.exe"

    info "Downloading Jean2 for windows..."
    info "URL: $url"

    $script:TEMP_FILE = [System.IO.Path]::GetTempFileName()

    try {
      Invoke-WebRequest -Uri $url -OutFile $TEMP_FILE
    } catch {
      error "Download failed"
    }

    success "Download complete"
    return $TEMP_FILE
  }

  function install_binary {
    param([string]$File)

    info "Installing to $BINARY_PATH..."

    $dir = Split-Path -Parent $BINARY_PATH
    if ((Test-Path $dir) -eq $false) {
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    Move-Item -Path $File -Destination $BINARY_PATH -Force

    success "Installed to $BINARY_PATH"
  }

  function configure_path {
    if ($SkipPath) {
      info "Skipping PATH configuration (--NoPath specified)"
      return
    }

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $pathParts = $userPath -split ';' | Where-Object { $_ -ne '' }

    if ($pathParts -contains $INSTALL_DIR) {
      info "PATH already configured"
      return
    }

    $newPath = "$INSTALL_DIR;$userPath"
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    $env:Path = "$INSTALL_DIR;$env:Path"

    success "Added Jean2 to PATH"
  }

  function update_existing_install {
    param([string]$Version)

    $wasRunning = $false
    $needsMigration = $false

    info "Jean2 is already installed at $BINARY_PATH"

    $currentVersion = check_existing_install
    info "Current version: $currentVersion"
    info "Target version: $Version"

    if ($currentVersion -eq $Version -and $Force -eq $false) {
      info "Already on version $Version. Use --Force to update anyway."
      exit 0
    }

    info "Checking if Jean2 daemon is running..."
    if (is_jean2_running) {
      $wasRunning = $true
      info "Jean2 daemon is running"
      stop_jean2
    } else {
      info "Jean2 daemon is not running"
    }

    info "Checking if Jean2 is initialized..."
    if (is_initialized) {
      $needsMigration = $true
      info "Jean2 is initialized, will run migrations"
    } else {
      info "Jean2 is not initialized, skipping migrations"
    }

    $tempFile = download_binary $Version

    install_binary $tempFile

    $newBinary = $BINARY_PATH

    if ($needsMigration) {
      run_migrations $newBinary
    }

    if ($wasRunning) {
      start_jean2 $newBinary
    } else {
      info "Jean2 was not running before update, not starting"
    }

    success "Jean2 updated from v$currentVersion to v$Version"
  }

  function main {
    parse_args

    if ([string]::IsNullOrEmpty($CustomVersion)) {
      $VERSION = fetch_version
      info "Using latest version: $VERSION"
    } else {
      $VERSION = $CustomVersion
      info "Using specified version: $VERSION"
    }

    $script:BINARY_PATH = Join-Path $INSTALL_DIR $BINARY_NAME

    if (Test-Path $BINARY_PATH) {
      update_existing_install $VERSION
    } else {
      if ($Force) {
        warn "--force specified but no existing installation found, proceeding with fresh install"
      }
      info "Fresh installation at $BINARY_PATH"

      $tempFile = download_binary $VERSION

      install_binary $tempFile

      configure_path

      Write-Host ""
      success "Jean2 v$VERSION installed successfully!"
      Write-Host ""
      info "Binary location: $BINARY_PATH"
      Write-Host ""

      if ($SkipPath) {
        @"
  Next steps:
    1. Add to PATH: setx PATH `"$INSTALL_DIR;%PATH%`"
    2. Initialize: $BINARY_PATH init
    3. Start:      $BINARY_PATH start
"@
      } else {
        @"
  Next steps:
    1. Restart your terminal (to apply PATH changes)
    2. Initialize: $BINARY_PATH init
    3. Start:      $BINARY_PATH start
"@
      }
      Write-Host ""
    }

    configure_path
  }

  main
} finally {
  cleanup
}
