import { app, Menu, BrowserWindow, shell, MenuItemConstructorOptions } from 'electron';

type WindowCreator = () => BrowserWindow;

// Helper to create a role-based menu item
function roleItem(role: MenuItemConstructorOptions['role']): MenuItemConstructorOptions {
  return { role };
}

// Helper to create a separator
function separator(): MenuItemConstructorOptions {
  return { type: 'separator' };
}

export function setupMenu(createWindow: WindowCreator): void {
  const isMac = process.platform === 'darwin';

  const macAppMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      roleItem('about'),
      separator(),
      {
        label: 'Preferences...',
        accelerator: 'Cmd+,',
        click: () => sendAcceleratorToFocusedWindow('preferences'),
      },
      separator(),
      roleItem('services'),
      separator(),
      roleItem('hide'),
      roleItem('hideOthers'),
      roleItem('unhide'),
      separator(),
      {
        label: `Quit ${app.name}`,
        accelerator: 'Cmd+Q',
        click: () => app.quit(),
      },
    ],
  };

  const fileMenuSubmenu: MenuItemConstructorOptions[] = [
    {
      label: 'New Window',
      accelerator: 'CmdOrCtrl+Shift+N',
      click: () => createWindow(),
    },
    separator(),
    roleItem('close'),
  ];

  if (!isMac) {
    fileMenuSubmenu.push(separator());
    fileMenuSubmenu.push({
      label: 'Exit',
      accelerator: 'Alt+F4',
      click: () => app.quit(),
    });
  }

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: fileMenuSubmenu,
  };

  const editMenuSubmenu: MenuItemConstructorOptions[] = [
    roleItem('undo'),
    roleItem('redo'),
    separator(),
    roleItem('cut'),
    roleItem('copy'),
    roleItem('paste'),
  ];

  if (isMac) {
    editMenuSubmenu.push({
      label: 'Paste and Match Style',
      accelerator: 'Shift+CmdOrCtrl+V',
      click: () => {
        const win = BrowserWindow.getFocusedWindow();
        if (win) {
          win.webContents.pasteAndMatchStyle();
        }
      },
    });
    editMenuSubmenu.push(roleItem('delete'));
    editMenuSubmenu.push(roleItem('selectAll'));
  } else {
    editMenuSubmenu.push(roleItem('delete'));
    editMenuSubmenu.push(separator());
    editMenuSubmenu.push(roleItem('selectAll'));
  }

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: editMenuSubmenu,
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      {
        label: 'Open Sidebar',
        accelerator: 'CmdOrCtrl+1',
        click: () => sendAcceleratorToFocusedWindow('open-sidebar'),
      },
      {
        label: 'Open Terminal',
        accelerator: 'CmdOrCtrl+T',
        click: () => sendAcceleratorToFocusedWindow('open-terminal'),
      },
      separator(),
      roleItem('reload'),
      roleItem('forceReload'),
      roleItem('toggleDevTools'),
      separator(),
      roleItem('resetZoom'),
      roleItem('zoomIn'),
      roleItem('zoomOut'),
      separator(),
      roleItem('togglefullscreen'),
    ],
  };

  const windowMenuSubmenu: MenuItemConstructorOptions[] = [
    roleItem('minimize'),
  ];

  if (isMac) {
    windowMenuSubmenu.push(roleItem('zoom'));
    windowMenuSubmenu.push(roleItem('front'));
    windowMenuSubmenu.push(separator());
  } else {
    windowMenuSubmenu.push({
      label: 'Maximize',
      click: () => {
        const win = BrowserWindow.getFocusedWindow();
        if (win) {
          if (win.isMaximized()) {
            win.unmaximize();
          } else {
            win.maximize();
          }
        }
      },
    });
    windowMenuSubmenu.push(separator());
  }

  windowMenuSubmenu.push(roleItem('close'));

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: windowMenuSubmenu,
  };

  const helpMenu: MenuItemConstructorOptions = {
    label: 'Help',
    submenu: [
      {
        label: 'Documentation',
        click: async () => {
          await shell.openExternal('https://github.com/capek-dev/prokop#readme');
        },
      },
      {
        label: 'Report Issue',
        click: async () => {
          await shell.openExternal('https://github.com/capek-dev/prokop/issues');
        },
      },
      {
        label: 'View on GitHub',
        click: async () => {
          await shell.openExternal('https://github.com/capek-dev/prokop');
        },
      },
      separator(),
      {
        label: 'About',
        click: () => sendAcceleratorToFocusedWindow('about'),
      },
    ],
  };

  const template: MenuItemConstructorOptions[] = isMac
    ? [macAppMenu, fileMenu, editMenu, viewMenu, windowMenu, helpMenu]
    : [fileMenu, editMenu, viewMenu, windowMenu, helpMenu];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function sendAcceleratorToFocusedWindow(accelerator: string): void {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow) {
    focusedWindow.webContents.send('accelerator', accelerator);
  }
}
