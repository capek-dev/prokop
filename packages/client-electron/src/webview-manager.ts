import { BrowserWindow, WebContentsView, Rectangle } from 'electron';

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ViewInfo {
  view: WebContentsView;
  bounds: ViewBounds;
  managedUrl: string;
}

export class WebviewManager {
  private views: Map<string, ViewInfo> = new Map();
  private idCounter = 0;

  createEmbeddedView(
    parentWindow: BrowserWindow,
    url: string,
    bounds: ViewBounds
  ): string {
    const id = `webview-${++this.idCounter}`;

    // Create a unique URL for this view that we can identify later
    const managedUrl = `${url}#prokopai-view-id=${id}`;

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: `view-${id}`,
      },
    });

    // Set up security: intercept navigation
    view.webContents.on('will-navigate', (_event, navigatedUrl) => {
      // Allow navigation within the same origin, but track managed URLs
      const parsedUrl = new URL(managedUrl);
      const navigatedParsed = new URL(navigatedUrl);

      // Block navigation to different origins
      if (navigatedParsed.origin !== parsedUrl.origin) {
        // Could open in external browser instead
        console.log(`[WebviewManager] Blocking navigation to: ${navigatedUrl}`);
      }
    });

    // Set up message passing from view to parent
    view.webContents.on('console-message', (_event, _level, message, _line, _sourceId) => {
      // Log console messages from embedded views for debugging
      console.log(`[WebviewManager:${id}] Console:`, message);
    });

    // Load the URL
    view.webContents.loadURL(url).catch((err) => {
      console.error(`[WebviewManager:${id}] Failed to load URL:`, err);
    });

    // Add view to parent window
    parentWindow.contentView.addChildView(view);
    view.setBounds(this.normalizeBounds(bounds));

    // Store view info
    this.views.set(id, {
      view,
      bounds,
      managedUrl,
    });

    console.log(`[WebviewManager] Created view ${id} at ${JSON.stringify(bounds)}`);

    return id;
  }

  removeView(id: string): void {
    const viewInfo = this.views.get(id);
    if (!viewInfo) {
      console.warn(`[WebviewManager] View ${id} not found`);
      return;
    }

    try {
      const window = BrowserWindow.fromWebContents(viewInfo.view.webContents);
      if (window) {
        window.contentView.removeChildView(viewInfo.view);
      }
      viewInfo.view.webContents.close();
    } catch (err) {
      console.error(`[WebviewManager] Error removing view ${id}:`, err);
    }

    this.views.delete(id);
    console.log(`[WebviewManager] Removed view ${id}`);
  }

  resizeView(id: string, bounds: ViewBounds): void {
    const viewInfo = this.views.get(id);
    if (!viewInfo) {
      console.warn(`[WebviewManager] View ${id} not found for resize`);
      return;
    }

    const normalizedBounds = this.normalizeBounds(bounds);
    viewInfo.view.setBounds(normalizedBounds);
    viewInfo.bounds = bounds;

    console.log(`[WebviewManager] Resized view ${id} to ${JSON.stringify(bounds)}`);
  }

  postMessageToView(id: string, message: unknown): void {
    const viewInfo = this.views.get(id);
    if (!viewInfo) {
      console.warn(`[WebviewManager] View ${id} not found for message`);
      return;
    }

    // Send message to the view's webContents
    viewInfo.view.webContents.send('message', message);

    console.log(`[WebviewManager] Posted message to view ${id}`);
  }

  isManagedUrl(url: string): boolean {
    for (const viewInfo of this.views.values()) {
      if (url.startsWith(viewInfo.managedUrl.split('#')[0])) {
        return true;
      }
    }
    return false;
  }

  getViewCount(): number {
    return this.views.size;
  }

  removeAllViews(): void {
    for (const id of this.views.keys()) {
      this.removeView(id);
    }
  }

  private normalizeBounds(bounds: ViewBounds): Rectangle {
    return {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    };
  }
}
