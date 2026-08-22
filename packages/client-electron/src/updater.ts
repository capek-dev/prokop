import electronUpdater from 'electron-updater';
import { BrowserWindow, dialog } from 'electron';
import electronLog from 'electron-log';

const { autoUpdater } = electronUpdater;
const log = electronLog.default || electronLog;
type UpdateInfo = import('electron-updater').UpdateInfo;

const UPDATE_CHECK_INTERVAL = 4 * 60 * 60 * 1000;
const GITHUB_OWNER = 'rabbyte-tech';
const GITHUB_REPO = 'jean2';

async function resolveLatestClientReleaseTag(): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`,
      {
        headers: { 'User-Agent': 'prokopai-updater' },
      },
    );
    if (!response.ok) return null;
    const releases = await response.json() as Array<{ tag_name: string; prerelease: boolean; assets: Array<{ name: string }> }>;
    const platformSuffix = process.platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml';
    const clientRelease = releases.find(
      (r) =>
        r.tag_name.startsWith('client/v') &&
        !r.prerelease &&
        r.assets.some((a) => a.name === platformSuffix),
    );
    return clientRelease?.tag_name ?? null;
  } catch {
    return null;
  }
}

async function configureFeedURL(): Promise<void> {
  const tag = await resolveLatestClientReleaseTag();
  if (tag) {
    const baseUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${encodeURIComponent(tag)}`;
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: baseUrl,
      channel: 'latest',
    });
    console.log(`[Updater] Using generic provider with URL: ${baseUrl}`);
  } else {
    console.log('[Updater] Could not resolve client release, falling back to default GitHub provider');
  }
}

async function checkForUpdates(): Promise<void> {
  console.log('[Updater] Checking for updates...');
  await configureFeedURL();
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[Updater] Error checking for updates:', err);
  });
}

export function setupUpdater(mainWindow: BrowserWindow): void {
  autoUpdater.logger = log;
  log.transports.file.level = 'info';

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for update...');
    sendUpdaterEvent(mainWindow, 'checking');
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log('[Updater] Update available:', info.version);
    sendUpdaterEvent(mainWindow, 'available', { version: info.version });
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    console.log('[Updater] Update not available:', info.version);
    sendUpdaterEvent(mainWindow, 'not-available', { version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[Updater] Download progress: ${progress.percent.toFixed(2)}%`);
    sendUpdaterEvent(mainWindow, 'download-progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    console.log('[Updater] Update downloaded:', info.version);
    sendUpdaterEvent(mainWindow, 'downloaded', { version: info.version });

    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: `Prokopai  has been downloaded.`,
        detail: 'The update will be installed when you restart the application.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err);
    sendUpdaterEvent(mainWindow, 'error', { message: err.message });
  });

  setTimeout(() => {
    checkForUpdates();
  }, 3000);

  setInterval(() => {
    checkForUpdates();
  }, UPDATE_CHECK_INTERVAL);
}

export function triggerUpdateCheck(): void {
  checkForUpdates();
}

function sendUpdaterEvent(
  window: BrowserWindow,
  type: string,
  data?: Record<string, unknown>
): void {
  if (!window.isDestroyed()) {
    window.webContents.send('updater:event', { type, data });
  }
}
