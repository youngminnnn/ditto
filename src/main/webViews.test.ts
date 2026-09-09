import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PREVIEW_PARTITION } from '@shared/types'
import type { HostedViewLayout } from '@shared/types'

const { webContentsViews, browserWindows } = vi.hoisted(() => ({
  webContentsViews: [] as Array<{
    webPreferences: Record<string, unknown>
    webContents: {
      destroyed: boolean
      on: ReturnType<typeof vi.fn>
      setWindowOpenHandler: ReturnType<typeof vi.fn>
      isDestroyed: () => boolean
      close: ReturnType<typeof vi.fn>
    }
    setBounds: ReturnType<typeof vi.fn>
    setVisible: ReturnType<typeof vi.fn>
    setBackgroundColor: ReturnType<typeof vi.fn>
  }>,
  browserWindows: new Map<
    number,
    {
      isDestroyed: () => boolean
      getContentBounds: () => { x: number; y: number; width: number; height: number }
      contentView: {
        addChildView: ReturnType<typeof vi.fn>
        removeChildView: ReturnType<typeof vi.fn>
      }
    }
  >()
}))

vi.mock('electron', () => {
  class FakeWebContents {
    destroyed = false
    on = vi.fn()
    setWindowOpenHandler = vi.fn()
    isDestroyed = (): boolean => this.destroyed
    close = vi.fn(() => {
      this.destroyed = true
    })
  }

  class FakeWebContentsView {
    webPreferences: Record<string, unknown>
    webContents = new FakeWebContents()
    setBounds = vi.fn()
    setVisible = vi.fn()
    setBackgroundColor = vi.fn()

    constructor(opts: { webPreferences: Record<string, unknown> }) {
      this.webPreferences = opts.webPreferences
      webContentsViews.push(this)
    }
  }

  return {
    BrowserWindow: { fromId: (id: number) => browserWindows.get(id) ?? null },
    WebContentsView: FakeWebContentsView,
    shell: { openExternal: vi.fn() }
  }
})

vi.mock('./windows', () => ({ windowBackgroundColor: () => '#f4f4f5' }))
vi.mock('./logger', () => ({ log: { info: vi.fn() } }))

/** 창 하나를 흉내 낸다. `BrowserWindow.fromId` 가 찾는 대상이 이 맵이다. */
function makeWindow(
  id: number,
  contentBounds = { x: 0, y: 0, width: 1000, height: 800 }
): {
  isDestroyed: () => boolean
  getContentBounds: () => typeof contentBounds
  contentView: { addChildView: ReturnType<typeof vi.fn>; removeChildView: ReturnType<typeof vi.fn> }
} {
  const win = {
    isDestroyed: () => false,
    getContentBounds: () => contentBounds,
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }
  }
  browserWindows.set(id, win)
  return win
}

beforeEach(() => {
  webContentsViews.length = 0
  browserWindows.clear()
})

async function makeManager(): Promise<InstanceType<typeof import('./webViews').HostedViewManager>> {
  const { HostedViewManager } = await import('./webViews')
  return new HostedViewManager(vi.fn())
}

describe('HostedViewManager', () => {
  it('ensure() 로 만든 뷰의 webPreferences 는 예전 will-attach-webview 가드가 강제하던 값 그대로다 — 하나라도 빠지면 게스트 격리가 조용히 뚫린다', async () => {
    const manager = await makeManager()

    manager.ensure('tab-1', 'ws-1', 'dev')

    expect(webContentsViews).toHaveLength(1)
    const prefs = webContentsViews[0].webPreferences
    expect(prefs.partition).toBe(PREVIEW_PARTITION)
    expect(prefs.contextIsolation).toBe(true)
    expect(prefs.sandbox).toBe(true)
    expect(prefs.nodeIntegration).toBe(false)
    expect(prefs.nodeIntegrationInSubFrames).toBe(false)
    expect(prefs.webviewTag).toBe(false)
    // preload 는 여기서 아예 안 넣는 것이 요점이다 — 지웠는지가 아니라 애초에 없는지를 본다.
    expect('preload' in prefs).toBe(false)
  })

  it('같은 tabId 로 두 번 ensure 해도 뷰는 하나다', async () => {
    const manager = await makeManager()

    manager.ensure('tab-1', 'ws-1', 'dev')
    manager.ensure('tab-1', 'ws-1', 'dev')

    expect(webContentsViews).toHaveLength(1)
  })

  it('applyLayout 은 그 뷰의 주인 창이 아니면 무시한다 — 분리 창과 메인 창이 같은 워크스페이스를 그릴 수 있어서다', async () => {
    const manager = await makeManager()
    manager.ensure('tab-1', 'ws-1', 'dev')
    makeWindow(1)
    makeWindow(2)
    manager.attach('tab-1', 1)

    const layout: HostedViewLayout = {
      tabId: 'tab-1',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      visible: true
    }
    manager.applyLayout(2, [layout])

    const view = webContentsViews[0]
    expect(view.setBounds).not.toHaveBeenCalled()
    expect(view.setVisible).not.toHaveBeenCalled()
  })

  it('다른 창으로 attach 하면 이전 창에서 떼고 새 창에 붙이되, webContents 는 살려 둔다(이관의 실익)', async () => {
    const manager = await makeManager()
    manager.ensure('tab-1', 'ws-1', 'dev')
    const win1 = makeWindow(1)
    const win2 = makeWindow(2)

    manager.attach('tab-1', 1)
    manager.attach('tab-1', 2)

    expect(win1.contentView.removeChildView).toHaveBeenCalledTimes(1)
    expect(win2.contentView.addChildView).toHaveBeenCalledTimes(1)
    expect(webContentsViews[0].webContents.close).not.toHaveBeenCalled()
  })

  it('detach 뒤에도 resolve 는 여전히 게스트를 돌려준다 — detach 는 파괴가 아니다', async () => {
    const manager = await makeManager()
    manager.ensure('tab-1', 'ws-1', 'dev')
    makeWindow(1)
    manager.attach('tab-1', 1)

    manager.detach('tab-1')

    const result = manager.resolve('tab-1')
    expect('guest' in result).toBe(true)
  })

  it('hold() 를 쥔 동안은 destroy 가 막히고, 놓으면 다시 파괴된다', async () => {
    const manager = await makeManager()
    manager.ensure('tab-1', 'ws-1', 'dev')
    const release = manager.hold('tab-1')

    manager.destroy('tab-1')
    expect('guest' in manager.resolve('tab-1')).toBe(true)

    release()
    manager.destroy('tab-1')
    expect('guest' in manager.resolve('tab-1')).toBe(false)
  })

  it('applyLayout 은 창 밖으로 나가는 좌표를 창 안으로 잘라 낸다', async () => {
    const manager = await makeManager()
    manager.ensure('tab-1', 'ws-1', 'dev')
    const win1 = makeWindow(1, { x: 0, y: 0, width: 500, height: 400 })
    manager.attach('tab-1', 1)

    manager.applyLayout(1, [
      { tabId: 'tab-1', x: 100, y: 100, width: 1000, height: 1000, visible: true }
    ])

    expect(webContentsViews[0].setBounds).toHaveBeenCalledWith({
      x: 100,
      y: 100,
      width: 400,
      height: 300
    })
    void win1
  })

  it('destroyWorkspace 는 같은 workspaceId 의 뷰만 지우고 다른 워크스페이스는 남긴다', async () => {
    const manager = await makeManager()
    manager.ensure('tab-1', 'ws-1', 'dev')
    manager.ensure('tab-2', 'ws-2', 'dev')

    manager.destroyWorkspace('ws-1')

    expect('guest' in manager.resolve('tab-1')).toBe(false)
    expect('guest' in manager.resolve('tab-2')).toBe(true)
  })
})
