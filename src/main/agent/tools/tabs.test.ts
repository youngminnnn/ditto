import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@shared/types'
import type { AgentToolDeps } from './registry'

/**
 * 이 테스트가 지키려는 것.
 *
 * 세 도구가 하는 일은 "탭을 연다" 한 줄이라 성공 경로는 얇다. 두꺼운 쪽은 **거절**이다 —
 * 모델이 넘긴 주소·경로·id 가 틀렸을 때 도구가 무엇을 말하느냐가 이 도구들의 실질적 계약이다.
 * 그 문장이 다음 턴에 모델이 읽고 스스로 고칠 재료이기 때문에, 실패 단언은 문장의 핵심 단어를
 * 정규식으로 잡는다.
 *
 * 그리고 `activate: true` 를 협력자 호출째로 못박는다. 이 셋이 `open_preview`(`activate: false`)
 * 와 갈리는 유일한 지점이고, 조용히 뒤집히면 "사용자가 보라고 여는" 도구가 아무도 못 보는
 * 탭을 여는 도구가 된다 — 아무것도 안 깨지면서 존재 이유만 사라지는 종류다.
 */

const state = vi.hoisted(() => ({
  workspaces: [] as Partial<Workspace>[],
  repos: [] as unknown[]
}))

const openTab = vi.fn(
  (_workspaceId: string, opts: { kind: string; target?: string; activate?: boolean }) => ({
    workspaceId: 'ws-1',
    tabs: [
      { id: 'work', kind: 'work' },
      { id: `tab-${opts.kind}`, kind: opts.kind, target: opts.target }
    ],
    activeId: 'work'
  })
)
const ensureView = vi.fn()
const guest = { loadURL: vi.fn(async () => undefined) }
const resolveView = vi.fn((_tabId: string) => ({ guest: guest as unknown as WebContents }))

const artifactList = vi.fn()
const artifactMeta = vi.fn()
const requestArtifactOpen = vi.fn()
const statMock = vi.hoisted(() => vi.fn())

vi.mock('../../store', () => ({ getStore: () => ({ getState: () => state }) }))
vi.mock('../../artifacts', () => ({
  getArtifacts: () => ({ list: artifactList, meta: artifactMeta })
}))
vi.mock('../../artifactProtocol', () => ({
  requestArtifactOpen: (...args: unknown[]) => requestArtifactOpen(...args)
}))
vi.mock('node:fs/promises', () => ({ stat: (...args: unknown[]) => statMock(...args) }))

const deps = {
  tabs: { openTab },
  views: { ensure: ensureView, resolve: resolveView }
} as unknown as AgentToolDeps

const ws: Partial<Workspace> = { id: 'ws-1', repoId: 'repo-1', worktreePath: '/tmp/wt' }

/** 실제 파일인 척한다. `stat` 이 무엇을 돌려주든 도구는 `isDirectory()` 만 묻는다. */
const asFile = { isDirectory: () => false }
const asDir = { isDirectory: () => true }

async function call(
  name: 'openWebTab' | 'openFileTab' | 'openArtifactTab',
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const mod = await import('./tabs')
  return mod[name](deps, 'ws-1', args) as Promise<Record<string, unknown>>
}

beforeEach(() => {
  vi.clearAllMocks()
  state.workspaces = [ws]
  statMock.mockResolvedValue(asFile)
  artifactList.mockReturnValue([])
  artifactMeta.mockReturnValue(null)
  guest.loadURL.mockResolvedValue(undefined)
})

describe('open_web_tab', () => {
  it('탭을 열고 메인이 직접 그 주소로 보낸다', async () => {
    const result = await call('openWebTab', { url: 'https://react.dev/learn' })

    expect(openTab).toHaveBeenCalledWith('ws-1', {
      kind: 'web',
      target: 'https://react.dev/learn',
      activate: true
    })
    // 주소를 ensure 에 넘기면 메인과 뷰가 각자 로드해 서로를 끊는다 — 인자는 셋뿐이어야 한다.
    expect(ensureView).toHaveBeenCalledWith('tab-web', 'ws-1', 'web')
    expect(guest.loadURL).toHaveBeenCalledWith('https://react.dev/learn')
    expect(result.url).toBe('https://react.dev/learn')
  })

  it('http(s) 가 아닌 스킴은 무엇이 허용되는지 말하며 거절한다', async () => {
    await expect(call('openWebTab', { url: 'file:///etc/passwd' })).rejects.toThrow(
      /http and https/
    )
    expect(openTab).not.toHaveBeenCalled()
  })

  it('javascript: 도 같은 이유로 막는다 — 게스트 가드까지 가면 모델은 아무 말도 못 듣는다', async () => {
    await expect(call('openWebTab', { url: 'javascript:alert(1)' })).rejects.toThrow(
      /http and https/
    )
  })

  it('주소가 아닌 문자열은 전체 URL 을 달라고 말한다', async () => {
    await expect(call('openWebTab', { url: 'react.dev' })).rejects.toThrow(/full URL/)
  })

  it('로드가 실패하면 그 사유를 그대로 올린다 — 열렸다고 답하지 않는다', async () => {
    guest.loadURL.mockRejectedValue(new Error('ERR_NAME_NOT_RESOLVED'))
    await expect(call('openWebTab', { url: 'https://nope.invalid' })).rejects.toThrow(
      /ERR_NAME_NOT_RESOLVED/
    )
  })
})

describe('open_file_tab', () => {
  it('상대경로를 그대로 탭 대상으로 쓴다', async () => {
    const result = await call('openFileTab', { path: 'src/main/index.ts' })

    expect(openTab).toHaveBeenCalledWith('ws-1', {
      kind: 'file',
      target: 'src/main/index.ts',
      activate: true
    })
    expect(result.path).toBe('src/main/index.ts')
  })

  it('절대경로를 워크트리 상대경로로 되돌린다 — 아니면 같은 파일이 두 탭이 된다', async () => {
    await call('openFileTab', { path: '/tmp/wt/src/main/index.ts' })
    expect(openTab).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ target: 'src/main/index.ts' })
    )
  })

  it('./ 접두사도 벗긴다', async () => {
    await call('openFileTab', { path: './src/main/index.ts' })
    expect(openTab).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ target: 'src/main/index.ts' })
    )
  })

  it('워크트리 밖으로 나가는 경로는 거절한다', async () => {
    await expect(call('openFileTab', { path: '../../../etc/passwd' })).rejects.toThrow(/outside/)
    expect(openTab).not.toHaveBeenCalled()
  })

  it('중간에 낀 .. 로 빠져나가는 것도 막는다 — 접두사 검사만으로는 통과한다', async () => {
    await expect(call('openFileTab', { path: 'src/../../etc/passwd' })).rejects.toThrow(/outside/)
  })

  it('없는 파일은 그 경로를 짚어 거절한다 — 빈 탭을 열지 않는다', async () => {
    statMock.mockRejectedValue(new Error('ENOENT'))
    await expect(call('openFileTab', { path: 'src/nope.ts' })).rejects.toThrow(/no file at/)
    expect(openTab).not.toHaveBeenCalled()
  })

  it('디렉터리는 파일을 지목하라고 말한다', async () => {
    statMock.mockResolvedValue(asDir)
    await expect(call('openFileTab', { path: 'src/main' })).rejects.toThrow(/directory/)
  })
})

describe('open_artifact_tab', () => {
  beforeEach(() => {
    artifactList.mockReturnValue([{ id: 'sales-report', versions: [3, 2, 1] }])
    artifactMeta.mockReturnValue({ id: 'sales-report', version: 2 })
  })

  it('버전을 안 주면 최신으로 연다', async () => {
    const result = await call('openArtifactTab', { artifact_id: 'sales-report' })
    expect(result.version).toBe(3)
    expect(requestArtifactOpen).toHaveBeenCalledWith('ws-1', 'sales-report', 3)
  })

  it('탭을 여는 것과 대상을 지목하는 것을 둘 다 한다 — 방송만으로는 듣는 화면이 없을 때 탭이 안 남는다', async () => {
    await call('openArtifactTab', { artifact_id: 'sales-report' })
    expect(openTab).toHaveBeenCalledWith('ws-1', { kind: 'artifact', activate: true })
    expect(requestArtifactOpen).toHaveBeenCalled()
  })

  it('옛 버전을 지목할 수 있다', async () => {
    const result = await call('openArtifactTab', { artifact_id: 'sales-report', version: 2 })
    expect(result.version).toBe(2)
    expect(requestArtifactOpen).toHaveBeenCalledWith('ws-1', 'sales-report', 2)
  })

  it('없는 id 는 있는 id 들을 실어 거절한다 — 모델이 오타를 고칠 수 있어야 한다', async () => {
    await expect(call('openArtifactTab', { artifact_id: 'sales-repot' })).rejects.toThrow(
      /"sales-report"/
    )
    expect(requestArtifactOpen).not.toHaveBeenCalled()
  })

  it('아티팩트가 하나도 없으면 create_artifact 를 지목한다', async () => {
    artifactList.mockReturnValue([])
    await expect(call('openArtifactTab', { artifact_id: 'anything' })).rejects.toThrow(
      /create_artifact/
    )
  })

  it('없는 버전은 있는 버전들을 실어 거절한다', async () => {
    artifactMeta.mockReturnValue(null)
    await expect(
      call('openArtifactTab', { artifact_id: 'sales-report', version: 9 })
    ).rejects.toThrow(/3, 2, 1/)
    expect(requestArtifactOpen).not.toHaveBeenCalled()
  })
})
