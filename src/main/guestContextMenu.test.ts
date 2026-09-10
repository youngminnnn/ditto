import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, ContextMenuParams, WebContents } from 'electron'

/**
 * 이 테스트가 지키려는 것.
 *
 * 우클릭 메뉴에서 진짜로 중요한 것은 **아티팩트에 바깥으로 나가는 문을 주지 않는 것**이다.
 * `applyArtifactGuards` 가 모델이 쓴 코드의 이동을 전부 막아 두는데, 메뉴에 "브라우저에서
 * 열기" 를 달면 그 울타리가 사용자 클릭 한 번으로 열린다 — 모델이 링크 글자를 그럴듯하게
 * 적고 주소에 방금 읽은 것을 실어 두면 사용자는 자기가 무엇을 여는지 모른 채 연다.
 *
 * 그 항목은 **없어도 아무것도 안 깨진다.** 그래서 실수로 들어와도 아무 신호가 없다 —
 * 테스트가 지키지 않으면 지켜지지 않는 종류다.
 *
 * 나머지 절반은 "누른 것에 맞는 항목이 뜨는가" 다. 링크를 눌렀는데 이미지 항목이 뜨거나
 * 아무것도 안 골랐는데 복사가 떠 있는 메뉴는 없느니만 못하다.
 */

const buildFromTemplate = vi.fn((template: unknown[]) => ({ template, popup: vi.fn() }))
const openExternal = vi.fn()
const writeText = vi.fn()

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: (t: unknown[]) => buildFromTemplate(t) },
  BrowserWindow: {},
  clipboard: { writeText: (t: string) => writeText(t) },
  shell: { openExternal: (u: string) => openExternal(u) }
}))

const win = { isDestroyed: () => false } as unknown as BrowserWindow

function fakeContents(): { contents: WebContents; fire: (p: Partial<ContextMenuParams>) => void } {
  let handler: ((e: unknown, p: ContextMenuParams) => void) | null = null
  const contents = {
    on: (event: string, cb: (e: unknown, p: ContextMenuParams) => void) => {
      if (event === 'context-menu') handler = cb
    },
    navigationHistory: { canGoBack: () => true, canGoForward: () => false },
    reload: vi.fn(),
    inspectElement: vi.fn(),
    copyImageAt: vi.fn(),
    replaceMisspelling: vi.fn()
  } as unknown as WebContents

  return {
    contents,
    fire: (p) => {
      const params = {
        x: 0,
        y: 0,
        linkURL: '',
        srcURL: '',
        selectionText: '',
        isEditable: false,
        hasImageContents: false,
        misspelledWord: '',
        dictionarySuggestions: [],
        editFlags: { canCut: true, canCopy: true, canPaste: true },
        ...p
      } as unknown as ContextMenuParams
      handler?.(null, params)
    }
  }
}

/** 템플릿을 사람이 읽는 이름의 평평한 목록으로 만든다(role 항목은 role 이름으로). */
function labels(): string[] {
  const template = buildFromTemplate.mock.calls.at(-1)?.[0] as
    Array<{ label?: string; role?: string; type?: string }> | undefined
  return (template ?? []).filter((i) => i.type !== 'separator').map((i) => i.label ?? i.role ?? '?')
}

async function open(
  kind: 'dev' | 'web' | 'artifact',
  params: Partial<ContextMenuParams>,
  ownerWindow: BrowserWindow | null = win
): Promise<void> {
  const { applyContextMenu } = await import('./guestContextMenu')
  const { contents, fire } = fakeContents()
  applyContextMenu(contents, kind, () => ownerWindow)
  fire(params)
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env['ELECTRON_RENDERER_URL']
})
afterEach(() => {
  delete process.env['ELECTRON_RENDERER_URL']
})

describe('아티팩트는 바깥으로 나가는 문을 얻지 않는다', () => {
  it('링크를 눌러도 "브라우저에서 열기" 가 없다', async () => {
    await open('artifact', { linkURL: 'https://evil.example/?d=secret' })
    expect(labels()).not.toContain('Open Link in Browser')
  })

  it('주소 복사는 남는다 — 클립보드는 아무 데도 가지 않는다', async () => {
    await open('artifact', { linkURL: 'https://example.com/doc' })
    expect(labels()).toContain('Copy Link Address')
  })

  it('이동 항목이 없다 — 갈 수 없는 곳으로 가는 버튼은 거짓말이다', async () => {
    await open('artifact', {})
    expect(labels()).not.toContain('Back')
    expect(labels()).not.toContain('Reload')
  })

  it('dev 실행이어도 개발자 도구를 주지 않는다', async () => {
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    await open('artifact', {})
    expect(labels()).not.toContain('Inspect Element')
  })
})

describe('웹·dev 탭', () => {
  it('링크를 누르면 브라우저에서 열 수 있다', async () => {
    await open('web', { linkURL: 'https://react.dev' })
    expect(labels()).toContain('Open Link in Browser')
  })

  it('이동 항목이 있고, 갈 수 없는 방향은 비활성이다', async () => {
    await open('web', {})
    const template = buildFromTemplate.mock.calls.at(-1)?.[0] as Array<{
      label?: string
      enabled?: boolean
    }>
    expect(template.find((i) => i.label === 'Back')?.enabled).toBe(true)
    expect(template.find((i) => i.label === 'Forward')?.enabled).toBe(false)
  })

  it('개발자 도구는 dev 실행에만 뜬다 — 앱 메뉴와 같은 기준이다', async () => {
    await open('dev', {})
    expect(labels()).not.toContain('Inspect Element')

    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    await open('dev', {})
    expect(labels()).toContain('Inspect Element')
  })
})

describe('누른 것에 맞는 항목만 뜬다', () => {
  it('편집 가능한 곳에서는 잘라내기·붙여넣기가 뜬다', async () => {
    await open('web', { isEditable: true })
    expect(labels()).toEqual(expect.arrayContaining(['cut', 'copy', 'paste', 'selectAll']))
  })

  it('맞춤법 제안이 맨 앞에 온다 — 편집 중 우클릭의 주된 용도다', async () => {
    await open('web', {
      isEditable: true,
      misspelledWord: 'teh',
      dictionarySuggestions: ['the', 'tea']
    })
    expect(labels().slice(0, 2)).toEqual(['the', 'tea'])
  })

  it('고른 글자가 없으면 복사가 안 뜬다', async () => {
    await open('web', {})
    expect(labels()).not.toContain('copy')
  })

  it('고른 글자가 있으면 복사가 뜬다', async () => {
    await open('web', { selectionText: '  hello  ' })
    expect(labels()).toContain('copy')
  })

  it('공백만 고른 것은 고른 것이 아니다', async () => {
    await open('web', { selectionText: '   ' })
    expect(labels()).not.toContain('copy')
  })

  it('이미지를 눌렀을 때만 이미지 항목이 뜬다', async () => {
    await open('web', { hasImageContents: true, srcURL: 'https://x/y.png' })
    expect(labels()).toEqual(expect.arrayContaining(['Copy Image', 'Copy Image Address']))

    await open('web', { linkURL: 'https://x' })
    expect(labels()).not.toContain('Copy Image')
  })

  it('빈 곳을 눌러도 빈 메뉴가 뜨지는 않는다', async () => {
    await open('artifact', {})
    expect(labels().length).toBeGreaterThan(0)
  })
})

describe('띄울 창', () => {
  it('어느 창에도 안 붙은 뷰에서는 아무것도 띄우지 않는다', async () => {
    await open('web', { linkURL: 'https://x' }, null)
    // 메뉴를 만들었더라도 popup 까지 가지 않는다 — 붙을 창이 없다.
    const built = buildFromTemplate.mock.results.at(-1)?.value as {
      popup: ReturnType<typeof vi.fn>
    }
    expect(built.popup).not.toHaveBeenCalled()
  })

  it('붙어 있으면 그 창에 띄운다', async () => {
    await open('web', { linkURL: 'https://x' })
    const built = buildFromTemplate.mock.results.at(-1)?.value as {
      popup: ReturnType<typeof vi.fn>
    }
    expect(built.popup).toHaveBeenCalledWith({ window: win })
  })
})
