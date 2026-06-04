import { app, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { SessionManager } from './claude/manager'
import { ScriptRunner } from './scripts'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null

/** 모든 창으로 채널 이벤트를 방송한다 (SessionManager/ScriptRunner 가 사용). */
function dispatch(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

const sessions = new SessionManager(dispatch, () => mainWindow)
const scripts = new ScriptRunner(dispatch)

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0c0e',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[ditto] renderer load failed: ${code} ${desc}`)
  })

  // 외부 링크(window.open / target=_blank)는 기본 브라우저로.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 앱 내 일반 링크(<a href> 클릭)가 창을 외부 URL 로 이동시키지 않게 가로채,
  // 사용자의 기본 브라우저로 연다. 개발 서버 URL 로의 이동만 허용.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    if (/^https?:\/\//.test(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc({ sessions, scripts, getWindow: () => mainWindow })
  createWindow()
  console.log('[ditto] main ready')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  sessions.disposeAll()
  scripts.disposeAll()
})
