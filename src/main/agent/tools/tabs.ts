import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Workspace } from '@shared/types'
import { requestArtifactOpen } from '../../artifactProtocol'
import { getArtifacts } from '../../artifacts'
import { getStore } from '../../store'
import { isInsideWorktree, toWorktreeRelative } from './paths'
import { loadGuest } from './preview'
import type { AgentToolDeps, AgentToolHandler } from './registry'

/**
 * 에이전트가 워크스페이스의 탭을 직접 여는 도구들 — 웹 주소, 워크트리의 파일, 아티팩트.
 *
 * 이 셋이 없으면 에이전트는 "이 파일을 보세요", "이 문서를 참고하세요" 를 **말로만** 할 수
 * 있고, 사용자가 직접 찾아 열어야 한다. `open_preview` 가 "고쳤다" 와 "정말 그렇게 보인다"
 * 사이의 사람을 없앤 것과 같은 왕복을 여기서 닫는다.
 *
 * **셋 다 화면을 그 탭으로 옮긴다(`activate: true`).** `open_preview` 가 옮기지 않는 것과
 * 갈리는데, 하는 일이 다르기 때문이다 — 프리뷰는 에이전트가 **자기 일을 검증하려고** 여는
 * 것이라 한 작업에서 여러 번 열리고, 그때마다 읽던 대화가 갈리면 안 된다. 이 셋은 반대로
 * **사용자가 보라고** 여는 것이 존재 이유다. 아무도 눈치채지 못하는 탭을 여는 도구는 실패한
 * 도구다.
 *
 * 승인은 도구마다 다르다. `NEVER_ASKS` 주석([[agent/tools/catalog]])이 못박은 네 문턱 —
 * worktree 밖으로 안 나가고, 네트워크를 안 건드리고, 한 동작으로 되돌리고, 결과가 화면에
 * 보일 것 — 에 대면 파일·아티팩트는 통과하고 **웹은 네트워크에서 걸린다.** 웹 탭이 쓰는
 * `persist:wooi-browser` 는 영속 세션이라 사용자가 로그인해 둔 쿠키를 달고 나가므로,
 * "어차피 에이전트에게는 셸이 있다" 는 논리가 여기서만 통하지 않는다.
 */

/** 중복 판정 키가 `kind + target` 이라, 방금 연 탭은 그 둘로 되찾는다. */
function tabIdFor(
  state: ReturnType<AgentToolDeps['tabs']['openTab']>,
  kind: string,
  target: string | undefined
): string | null {
  return state.tabs.find((t) => t.kind === kind && t.target === target)?.id ?? null
}

function workspaceOf(workspaceId: string): Workspace {
  const ws = getStore()
    .getState()
    .workspaces.find((w) => w.id === workspaceId)
  if (!ws) throw new Error('This workspace no longer exists.')
  return ws
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 웹 탭을 열고 그 주소로 보낸다.
 *
 * 스킴을 **도구가 먼저** 거절하는 것이 요점이다. `applyGuestGuards`([[main/webViews]])가 이미
 * 비 http(s) 이동을 막지만, 거기서 막히면 모델에게는 아무 말도 안 돌아온다 — 조용히 빈 탭이
 * 열린다. 도구가 거절해야 그 문장이 다음 턴의 지시가 된다.
 */
export const openWebTab: AgentToolHandler = async (deps, workspaceId, args) => {
  const raw = str(args.url)
  if (!raw) throw new Error('Pass the full address to open, such as "https://react.dev".')

  const parsed = (() => {
    try {
      return new URL(raw)
    } catch {
      return null
    }
  })()
  if (!parsed) {
    throw new Error(`"${raw}" is not a valid address. Pass a full URL including https://.`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `A web tab can only open http and https addresses; "${raw}" is ${parsed.protocol.replace(':', '')}. ` +
        'To show a file from this worktree, use open_file_tab instead.'
    )
  }
  const url = parsed.toString()

  const state = deps.tabs.openTab(workspaceId, { kind: 'web', target: url, activate: true })
  const tabId = tabIdFor(state, 'web', url)
  if (!tabId) throw new Error('Wooi could not open a web tab for this workspace.')

  // 주소는 `ensure` 에 넘기지 않는다 — 메인과 뷰가 각자 로드하면 서로를 ERR_ABORTED 로 끊어
  // 실패 사유가 사라진다([[agent/tools/preview]] loadGuest).
  deps.views.ensure(tabId, workspaceId, 'web')

  const view = deps.views.resolve(tabId)
  if ('error' in view) throw new Error(view.error)
  await loadGuest(view.guest, url)

  return {
    url,
    tabId,
    shownTo: 'The user is now looking at this tab.'
  }
}

/**
 * 워크트리의 파일을 탭으로 연다.
 *
 * 존재를 **미리** 확인하는 이유: 없는 경로로 탭을 열면 사용자가 "파일이 없습니다" 를 보게
 * 되는데, 그건 사용자가 고칠 수 있는 종류의 실패가 아니다. 모델에게 돌려주면 오타를 고쳐
 * 다시 부른다.
 */
export const openFileTab: AgentToolHandler = async (deps, workspaceId, args) => {
  const ws = workspaceOf(workspaceId)
  const raw = str(args.path)
  if (!raw) throw new Error('Pass the path of the file to open, such as "src/main/index.ts".')

  const rel = toWorktreeRelative(raw, ws.worktreePath)
  if (!isInsideWorktree(rel, ws.worktreePath)) {
    throw new Error(
      `"${raw}" is outside this workspace's worktree. A file tab can only show files in this worktree.`
    )
  }

  const info = await stat(resolve(ws.worktreePath, rel)).catch(() => null)
  if (!info) throw new Error(`There is no file at "${rel}" in this worktree.`)
  if (info.isDirectory()) {
    throw new Error(`"${rel}" is a directory. A file tab shows one file — name the file to open.`)
  }

  const state = deps.tabs.openTab(workspaceId, { kind: 'file', target: rel, activate: true })
  const tabId = tabIdFor(state, 'file', rel)
  if (!tabId) throw new Error('Wooi could not open a file tab for this workspace.')

  return {
    path: rel,
    tabId,
    shownTo: 'The user is now looking at this file.'
  }
}

/**
 * 이 워크스페이스가 만든 아티팩트를 탭으로 연다.
 *
 * **이 도구만 배선이 다르다.** 아티팩트 탭은 아티팩트 하나당 하나가 아니라 워크스페이스당
 * 하나(목록)이고 `target` 을 쓰지 않으므로([[renderer/tabs/ArtifactTab]]), `openTab` 만으로는
 * "어느 아티팩트의 몇 번째 버전" 을 전할 수 없다. 그 지목은 `evtArtifactOpen` 이 나른다.
 *
 * 그래서 둘을 **모두** 부른다. 방송을 받는 쪽([[renderer/App]])도 탭을 열지만 그건 렌더러가
 * 살아 듣고 있을 때뿐이고, 메인에서 먼저 열어 두면 듣는 화면이 없어도 탭은 남는다. `openTab`
 * 은 `kind + target(undefined)` 으로 중복을 걸러서 두 번 불려도 탭은 하나다.
 */
export const openArtifactTab: AgentToolHandler = async (deps, workspaceId, args) => {
  const id = str(args.artifact_id)
  if (!id) throw new Error('Pass the artifact_id you gave create_artifact.')

  const all = getArtifacts().list(workspaceId)
  const found = all.find((a) => a.id === id)
  if (!found) {
    if (!all.length) {
      throw new Error(
        'This workspace has no artifacts yet. Make one with create_artifact before opening it.'
      )
    }
    const names = all.map((a) => `"${a.id}"`).join(', ')
    throw new Error(`This workspace has no artifact called "${id}". It has: ${names}.`)
  }

  // versions 는 최신이 앞이다([[artifacts]] list).
  const latest = found.versions[0]
  const asked = args.version
  let version = latest
  if (asked != null) {
    if (typeof asked !== 'number' || !Number.isInteger(asked)) {
      throw new Error(`version must be a whole number; got ${JSON.stringify(asked)}.`)
    }
    if (!getArtifacts().meta(workspaceId, id, asked)) {
      const have = found.versions.join(', ')
      throw new Error(`"${id}" has no version ${asked}. Its versions are: ${have}.`)
    }
    version = asked
  }

  deps.tabs.openTab(workspaceId, { kind: 'artifact', activate: true })
  requestArtifactOpen(workspaceId, id, version)

  return {
    artifactId: id,
    version,
    shownTo: 'The user is now looking at this artifact.'
  }
}
