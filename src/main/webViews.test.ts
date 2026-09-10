import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_PARTITION, PREVIEW_PARTITION } from '@shared/types'
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
      getURL: () => string
      isLoading: () => boolean
      loadURL: ReturnType<typeof vi.fn>
      navigationHistory: { canGoBack: () => boolean; canGoForward: () => boolean }
    }
    setBounds: ReturnType<typeof vi.fn>
    setVisible: ReturnType<typeof vi.fn>
    setBackgroundColor: ReturnType<typeof vi.fn>
  }>,
  browserWindows: new Map<
    number,
    {
      id: number
      isDestroyed: () => boolean
      getContentBounds: () => { x: number; y: number; width: number; height: number }
      // 매니저가 창이 닫힐 때 뷰를 떼려고 `closed` 를 한 번 건다([[main/webViews]] watchWindow).
      once: ReturnType<typeof vi.fn>
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
    // 이미 있는 뷰에 다시 ensure 하면 매니저가 지금 상태를 한 번 밀어 준다 — 그 경로가
    // 이것들을 읽는다(그 동작이 "탭을 오가도 페이지가 안 되감긴다" 를 지탱한다).
    url = ''
    getURL = (): string => this.url
    isLoading = (): boolean => false
    loadURL = vi.fn((next: string) => {
      this.url = next
      return Promise.resolve()
    })
    navigationHistory = { canGoBack: (): boolean => false, canGoForward: (): boolean => false }
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
  id: number
  isDestroyed: () => boolean
  getContentBounds: () => typeof contentBounds
  once: ReturnType<typeof vi.fn>
  contentView: { addChildView: ReturnType<typeof vi.fn>; removeChildView: ReturnType<typeof vi.fn> }
} {
  const win = {
    id,
    isDestroyed: () => false,
    getContentBounds: () => contentBounds,
    // 매니저가 창 닫힘을 한 번 듣는다 — 창이 사라지면 그 렌더러의 언마운트가 돌지 않아
    // detach 를 기다릴 수 없기 때문이다.
    once: vi.fn(),
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

  it('웹 탭은 dev 와 다른 파티션을 쓴다 — 문서 사이트 쿠키가 dev 서버 요청에 실려 나가면 안 된다', async () => {
    const manager = await makeManager()
    manager.ensure('tab-dev', 'ws-1', 'dev')
    manager.ensure('tab-web', 'ws-1', 'web')

    const dev = webContentsViews[0].webPreferences.partition
    const web = webContentsViews[1].webPreferences.partition
    expect(dev).toBe(PREVIEW_PARTITION)
    expect(web).toBe(BROWSER_PARTITION)
    expect(dev).not.toBe(web)
  })

  it('종류마다 파티션이 명시적으로 골라져 있다 — 빠뜨리면 dev 세션으로 조용히 떨어지던 자리다', async () => {
    const { partitionFor } = await import('./webViews')
    // `partitionFor` 가 삼항이던 시절에는 "웹이 아니면 dev" 였다. 종류를 하나 더하면 그것이
    // 아무 말 없이 dev 서버의 **영속** 세션을 쓰게 되는데, 아티팩트가 정확히 그 경우다 —
    // 모델이 쓴 코드가 우리 쿠키에 닿는 것은 파티션 분리가 막으려던 바로 그것이다.
    expect(partitionFor('dev', 'ws-1')).toBe(PREVIEW_PARTITION)
    expect(partitionFor('web', 'ws-1')).toBe(BROWSER_PARTITION)
    // 아티팩트는 워크스페이스마다 갈리고 영속하지 않는다 — 모델이 쓴 코드의 스토리지가
    // 워크스페이스 경계를 넘거나 디스크에 남으면 안 된다.
    expect(partitionFor('artifact', 'ws-1')).not.toBe(partitionFor('artifact', 'ws-2'))
    expect(partitionFor('artifact', 'ws-1')).not.toMatch(/^persist:/)
    // 타입에 없는 종류가 흘러 들어오면 조용히 넘어가지 않고 던진다(컴파일러가 먼저 잡지만,
    // 런타임 경로로 새 kind 가 들어오는 경우까지 닫는다).
    expect(() => partitionFor('nope' as never, 'ws-1')).toThrow(/no session partition/)
  })

  it('같은 tabId 로 두 번 ensure 해도 뷰는 하나다', async () => {
    const manager = await makeManager()

    manager.ensure('tab-1', 'ws-1', 'dev')
    manager.ensure('tab-1', 'ws-1', 'dev')

    expect(webContentsViews).toHaveLength(1)
  })

  it('이미 있는 탭에 다시 ensure 해도 첫 주소를 또 로드하지 않는다 — 탭을 오갈 때마다 페이지가 처음으로 되감기던 자리다', async () => {
    const manager = await makeManager()
    manager.ensure('tab-1', 'ws-1', 'dev', 'http://localhost:5173/')
    const wc = webContentsViews[0].webContents
    expect(wc.loadURL).toHaveBeenCalledTimes(1)

    // 렌더러가 탭을 떠났다 돌아오면 자리표시자가 다시 마운트되고 ensure 가 또 불린다.
    manager.ensure('tab-1', 'ws-1', 'dev', 'http://localhost:5173/')
    expect(wc.loadURL).toHaveBeenCalledTimes(1)
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

  it('예산을 넘으면 오래 안 본 뷰부터 정리한다 — 뷰 하나가 렌더러 프로세스 하나다', async () => {
    const manager = await makeManager()
    const win = makeWindow(1)
    // 7 개를 만든다(상한은 6). 만든 순서대로 마지막으로 보인 시각이 앞선다.
    for (let i = 0; i < 7; i++) {
      manager.ensure(`tab-${i}`, 'ws-1', 'dev')
      manager.attach(`tab-${i}`, win.id)
    }

    // 가장 오래 안 본 것 하나가 사라지고 나머지는 남는다.
    expect('guest' in manager.resolve('tab-0')).toBe(false)
    expect('guest' in manager.resolve('tab-6')).toBe(true)
  })

  it('보고 있는 뷰는 예산에 걸려도 정리되지 않는다 — 사용자가 보던 화면이 사라지면 버그로 읽힌다', async () => {
    const manager = await makeManager()
    const win = makeWindow(1)
    manager.ensure('tab-keep', 'ws-1', 'dev')
    manager.attach('tab-keep', win.id)
    manager.applyLayout(win.id, [
      { tabId: 'tab-keep', x: 0, y: 0, width: 100, height: 100, visible: true }
    ])

    for (let i = 0; i < 8; i++) manager.ensure(`tab-${i}`, 'ws-1', 'dev')

    expect('guest' in manager.resolve('tab-keep')).toBe(true)
  })

  it('창이 닫히면 그 창의 뷰를 뗀다 — 파괴가 아니다(분리 창을 닫았다고 페이지가 죽으면 안 된다)', async () => {
    const manager = await makeManager()
    const win = makeWindow(1)
    manager.ensure('tab-1', 'ws-1', 'dev')
    manager.attach('tab-1', win.id)

    // 창이 사라지면 그 렌더러의 언마운트가 돌지 않는다 — 매니저가 직접 듣는 이유다.
    const closed = win.once.mock.calls.find(([event]) => event === 'closed')?.[1] as () => void
    expect(closed).toBeTypeOf('function')
    closed()

    expect('guest' in manager.resolve('tab-1')).toBe(true)
    expect(webContentsViews[0].webContents.close).not.toHaveBeenCalled()
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
