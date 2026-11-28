import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronUpdater from 'electron-updater'
import { envVar, startCore } from '@kothar/core/main'
import { fixPath } from './shell-path.ts'
import { createUpdates, type Updates } from './updates.ts'

// The packaged app is one bundled main.mjs with the UI, preload, icon and built-in extensions beside it (see
// scripts/stage.mjs); from the repo, each sits where the source tree has it.
const packaged = app.isPackaged
const local = (inRepo: string, inApp: string) => fileURLToPath(new URL(packaged ? inApp : inRepo, import.meta.url))
const uiDir = local('../../ui/dist', 'ui')
const preload = local('preload.cjs', 'preload.cjs')
const extensionsDir = packaged ? fileURLToPath(new URL('extensions/', import.meta.url)) : undefined
// A page that dies again this soon after a reload stays dead instead of looping.
const RELOAD_COOLDOWN_MS = 10_000
const icon = local('../assets/icon.png', 'icon.png')
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const VIBRANCY = 'sidebar'
// The menu's keys until the UI sends the user's own (the defaults in packages/ui/src/shortcuts.ts).
const MENU_DEFAULTS: Record<string, string | null> = {
  search: 'CmdOrCtrl+O',
  newSpace: 'CmdOrCtrl+N',
  newSpaceFromFolder: 'CmdOrCtrl+Shift+O',
  settings: 'CmdOrCtrl+,',
  toggleSidebar: 'CmdOrCtrl+[',
  toggleContextPanel: 'CmdOrCtrl+]',
  lastChat: 'Ctrl+Tab',
}

// Electron's own folder (Chromium's caches and the window's localStorage, where UI preferences live) would otherwise
// land in the garage, which shares the app's name.
// KOTHAR_USER_DATA moves it, with the single-instance lock, so a test copy runs beside the user's own Kothar.
app.setPath('userData', envVar(process.env, 'USER_DATA') ?? join(app.getPath('appData'), 'Kothar Desktop'))
if (!app.requestSingleInstanceLock()) app.quit()
else
  start().catch(async (error: unknown) => {
    // Another Kothar holds the garage (npm run dev, or a copy outside this app's single-instance lock): say so plainly.
    if (/already running on this garage/.test(errorText(error))) {
      await app.whenReady()
      await dialog.showMessageBox({
        type: 'warning',
        message: 'Kothar is already running',
        detail: `${errorText(error)}\n\nQuit the other Kothar, then open this one again.`,
      })
    } else dialog.showErrorBox('Kothar could not start', errorText(error))
    app.exit(1)
  })

async function start() {
  // Opened from Finder, the app has launchd's bare PATH and would find no engine.
  if (packaged) await fixPath()
  await app.whenReady()
  if (process.platform === 'darwin') app.dock?.setIcon(icon)
  // Restart (Settings, after community extension changes) quits as usual, stopping every chat and process, then
  // relaunches.
  const kothar = await startCore({
    uiDir,
    ...(extensionsDir && { extensionsDir }),
    restart: () => {
      app.relaunch()
      app.quit()
    },
    // Show in Finder: the core has already checked the path is one of Kothar's own (host.reveal).
    reveal: async (path) => shell.showItemInFolder(path),
  })

  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 375,
    minHeight: 600,
    useContentSize: true,
    title: 'Kothar',
    icon,
    show: false,
    // Only a window created with vibrancy gets a see-through compositor; adding it later paints over stale frames.
    vibrancy: VIBRANCY,
    visualEffectState: 'active',
    // Chromium's PDF viewer counts as a plugin, and attachment previews need it.
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true,
      // Tells the preload to offer the updater (window.kothar.updates), which only the packaged app runs.
      ...(packaged && { additionalArguments: ['--kothar-updates'] }),
    },
  })
  window.once('ready-to-show', () => window.show())
  let lastReloadMs = 0
  window.webContents.on('render-process-gone', (_event, { reason }) => {
    if (reason === 'clean-exit' || Date.now() - lastReloadMs < RELOAD_COOLDOWN_MS) return
    lastReloadMs = Date.now()
    window.reload()
  })

  let closing: Promise<void> | undefined
  // Set by the update notice's Restart: once the engines have stopped, install the downloaded update and relaunch.
  let installUpdate = false
  const installAndQuit = () => {
    // Squirrel.Mac may still be unpacking the update; if it never finishes, quit anyway (it installs next time).
    setTimeout(() => app.quit(), 60_000).unref()
    try {
      electronUpdater.autoUpdater.quitAndInstall()
    } catch (error) {
      console.warn('[updates]', error)
      app.quit()
    }
  }
  let closed = false
  let confirming = false
  let forcing = false
  const forceQuit = () => {
    forcing = true
    void kothar.close(true)
  }
  const confirmForceQuit = async () => {
    if (confirming || forcing || closed) return
    confirming = true
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning',
      message: 'Force quit?',
      detail: 'Engines stop without finishing their turn. Any still running after a few seconds are killed.',
      buttons: ['Force Quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    })
    confirming = false
    if (response === 0) forceQuit()
  }
  app.on('before-quit', (event) => {
    if (closed) return
    event.preventDefault()
    if (closing) return void confirmForceQuit()
    if (kothar.core.chats().some((c) => c.status !== 'idle')) window.webContents.send('quitting')
    closing = kothar.close().finally(() => {
      closed = true
      if (installUpdate) installAndQuit()
      else app.quit()
    })
  })
  window.on('close', (event) => {
    if (closed) return
    event.preventDefault()
    app.quit()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('second-instance', () => {
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  ipcMain.handle('force-quit', confirmForceQuit)
  const onSignal = () => {
    if (forcing) app.exit(1)
    else if (closing) forceQuit()
    else app.quit()
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, onSignal)

  const updates = packaged ? startUpdates(window, () => (installUpdate = true)) : undefined

  const pickFolder = async (title = 'New space from folder') => {
    const result = await dialog.showOpenDialog(window, { title, properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }
  ipcMain.handle('pick-folder', (_event, title?: string) => pickFolder(title))
  ipcMain.handle('pick-files', async (_event, title = 'Choose files') => {
    const result = await dialog.showOpenDialog(window, { title, properties: ['openFile', 'multiSelections'] })
    return result.canceled ? [] : result.filePaths
  })
  // The UI decides when to notify (packages/ui/src/notifications.ts); clicking one brings the window up on its chat.
  // Each is kept until clicked or closed, or macOS may drop it (and its click) once it's garbage collected.
  const notifications = new Set<Notification>()
  ipcMain.on('notify', (_event, shown: { title?: unknown; body?: unknown; open?: unknown }) => {
    if (!Notification.isSupported() || typeof shown?.title !== 'string') return
    const notification = new Notification({ title: shown.title, body: typeof shown.body === 'string' ? shown.body : '' })
    const open = typeof shown.open === 'string' ? shown.open : undefined
    notifications.add(notification)
    notification.on('click', () => {
      notifications.delete(notification)
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
      if (open !== undefined) window.webContents.send('open-chat', open)
    })
    notification.on('close', () => notifications.delete(notification))
    notification.show()
  })
  ipcMain.on('set-appearance', (_event, appearance: { scheme: string; vibrancy: boolean; background: string }) => {
    const { scheme, vibrancy, background } = appearance
    if (scheme === 'system' || scheme === 'light' || scheme === 'dark') nativeTheme.themeSource = scheme
    if (process.platform === 'darwin') window.setVibrancy(vibrancy ? VIBRANCY : null)
    window.setBackgroundColor(background)
  })

  // The menu shows the user's own keys: the UI sends them on start and whenever they change (Settings → Shortcuts).
  // A click runs the same action as the keys; a key press the page already handled never reaches the menu.
  let accelerators: Record<string, string | null> = MENU_DEFAULTS
  const item = (action: string, label: string) => ({
    label,
    accelerator: accelerators[action] ?? undefined,
    click: () => window.webContents.send('shortcut', action),
  })
  const buildMenu = () => {
    const mac = process.platform === 'darwin'
    const settings = item('settings', mac ? 'Settings…' : 'Settings')
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(mac
          ? [
              {
                label: app.name,
                submenu: [
                  { role: 'about' as const },
                  ...(updates ? [{ label: 'Check for Updates…', click: () => updates.check(true) }] : []),
                  { type: 'separator' as const },
                  settings,
                  { type: 'separator' as const },
                  { role: 'services' as const },
                  { type: 'separator' as const },
                  { role: 'hide' as const },
                  { role: 'hideOthers' as const },
                  { role: 'unhide' as const },
                  { type: 'separator' as const },
                  { role: 'quit' as const },
                ],
              },
            ]
          : []),
        {
          label: 'File',
          submenu: [
            item('search', 'Search…'),
            { type: 'separator' },
            item('newSpace', 'New space…'),
            item('newSpaceFromFolder', 'New space from folder…'),
            ...(mac ? [] : [settings]),
            { type: 'separator' },
            { role: mac ? 'close' : 'quit' },
          ],
        },
        { role: 'editMenu' },
        {
          label: 'View',
          submenu: [
            item('toggleSidebar', 'Sidebar'),
            item('toggleContextPanel', 'Context panel'),
            { type: 'separator' },
            item('lastChat', 'Last chat'),
            { type: 'separator' },
            // The rest of Electron's own View menu.
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
          ],
        },
        { role: 'windowMenu' },
      ]),
    )
  }
  buildMenu()
  ipcMain.on('set-menu-shortcuts', (_event, next: Record<string, string | null>) => {
    accelerators = { ...MENU_DEFAULTS, ...next }
    buildMenu()
  })

  const openOutside = (url: string) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === kothar.uiUrl) return
    event.preventDefault()
    openOutside(url)
  })
  await window.loadURL(kothar.openUrl)
}

// The updater (updates.ts), in the packaged app only: an unpackaged run has no app-update.yml, and Squirrel.Mac would
// refuse an update signed differently from it anyway. Its state goes to the window as 'update-state'; the window's
// notice and Settings → General call back through the preload (window.kothar.updates). Restart quits the normal way
// (installUpdateOnQuit makes before-quit stop the engines, then install instead of only quitting).
function startUpdates(window: BrowserWindow, installUpdateOnQuit: () => void): Updates {
  const { autoUpdater } = electronUpdater
  // electron-updater logs every step; the console is where the rest of Kothar's main process logs too.
  autoUpdater.logger = { info: () => {}, warn: (m: unknown) => console.warn('[updates]', m), error: () => {}, debug: () => {} }
  const show = async (options: Electron.MessageBoxOptions) => {
    if (window.isMinimized()) window.restore()
    window.show()
    return dialog.showMessageBox(window, options)
  }
  const updates = createUpdates({
    updater: autoUpdater,
    current: app.getVersion(),
    prefsFile: join(app.getPath('userData'), 'updates.json'),
    publish: (info) => {
      if (window.isDestroyed()) return
      // The menu's Check for Updates… opens the notice; bring the window up so it's seen.
      if (info.prompt && window.isMinimized()) window.restore()
      window.webContents.send('update-state', info)
    },
    ask: {
      upToDate: (current) =>
        void show({ type: 'info', message: 'You’re up to date', detail: `Kothar ${current} is the newest version.` }),
      failed: (message) =>
        void show({ type: 'warning', message: 'Couldn’t check for updates', detail: message }),
    },
    restart: () => {
      installUpdateOnQuit()
      app.quit()
    },
  })
  ipcMain.handle('update-info', () => updates.info())
  ipcMain.on('update-check', () => updates.check())
  ipcMain.on('update-download', () => updates.download())
  ipcMain.on('update-decline', () => updates.decline())
  ipcMain.on('update-later', () => updates.later())
  ipcMain.on('update-restart', () => updates.restart())
  app.on('will-quit', () => updates.stop())
  updates.start()
  return updates
}
