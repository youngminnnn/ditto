/* global console, process, window */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { seedAppState, waitForInspection } from '../fixtures.mjs'
import { launchWooi, withScratchRepo } from '../harness.mjs'

/**
 * 에이전트가 **옆 워크스페이스를 정리하고 자기 자신도 접는** 두 도구.
 *
 * 유닛 테스트는 핸들러를 부르지만 이 기능에서 실제로 지켜야 하는 것은 그 앞뒤다 — 대상 경계가
 * "내가 만든 것" 에서 **"사용자가 카드에서 승인한 것"** 으로 옮겨 갔으므로, 카드가 정말로 뜨는지와
 * 거기에 무엇이 적히는지가 곧 안전장치 전부다. 그래서 스토어를 디스크에 심고 → 실제 슬래시
 * 명령을 치고 → 화면에 뜬 카드를 눌러 → 사이드바와 스토어가 어떻게 되는지까지 본다.
 *
 * 창구는 `/wooi:archive` · `/wooi:delete` 다. 둘 다 direct 명령이라 에이전트 턴도 토큰도 쓰지
 * 않으므로, 모델을 띄우지 않는 e2e 에서 이 도구를 끝까지 밟을 수 있는 길이다
 * (message-status.spec.mjs 와 같은 수법).
 */

const CALLER = 'cleanup-caller'
const VICTIM = 'cleanup-victim'
/** 삭제 순간에 **사용자가 보고 있는** 워크스페이스. 마지막 절이 이것 하나 때문에 있다. */
const VIEWED = 'cleanup-viewed'

/**
 * 호출자와, 호출자가 **만들지 않은** 워크스페이스 둘.
 *
 * `createdByWorkspaceId: null` 이 이 스펙의 전제다 — 예전 규칙이라면 지목 자체가 거절됐다.
 * 호출자는 `fullAccess` 로 둔다. "묻지 마" 모드에서도 카드가 뜨는 것이 새 경계의 근거이므로,
 * 기본 모드에서 확인하면 정작 확인해야 할 것을 확인하지 않은 셈이 된다.
 */
async function seedCallerAndVictims(scratch) {
  await seedAppState(scratch, {
    workspaceName: CALLER,
    workspace: { permissionMode: 'fullAccess', displayName: null }
  })
  const file = join(scratch.userDataPath, 'wooi.json')
  const state = JSON.parse(await readFile(file, 'utf8'))
  const template = state.workspaces[0]

  const other = (name) => ({
    ...template,
    id: `ws-${name}`,
    name,
    displayName: null,
    branch: name,
    baseBranch: 'main',
    parentWorkspaceId: null,
    createdByWorkspaceId: null,
    worktreePath: scratch.worktrees[name],
    permissionMode: 'default',
    status: 'idle',
    sessionId: null
  })
  state.workspaces = [template, other(VICTIM), other(VIEWED)]
  await writeFile(file, JSON.stringify(state, null, 2))

  // 지울 워크트리에 커밋 안 된 파일을 남긴다 — 카드가 무엇을 잃는지 세어 적는지 보려면
  // 잃을 것이 실제로 있어야 한다.
  await writeFile(join(scratch.worktrees[VICTIM], 'scratch.txt'), 'work in progress\n')
}

const row = (win, name) => win.locator('[role="button"]').filter({ hasText: name }).first()
const allowButton = (win) => win.locator('button', { hasText: /^Allow$/ }).first()
const state = (win) => win.evaluate(() => window.api.getState())

/**
 * 직접 실행 명령을 치고, 뜬 승인 카드를 눌러 결과 JSON 을 돌려준다.
 *
 * `Allow` 를 기다리는 것이 곧 **"카드가 떴다"** 는 단언이다 — 이 두 도구에서는 그것이 지나가는
 * 확인이 아니라 검증 대상이다. 카드 문장은 렌더된 DOM 이 아니라 요청 payload 에서 읽는다.
 * 카드는 그 값을 그대로 그리므로 같은 것을 보면서, 마크업 클래스에 스펙을 매달지 않는다.
 *
 * 뒤 공백으로 자동완성 메뉴를 닫는 것은 다른 슬래시 스펙과 같은 이유다(Escape 는 초안을 비운다).
 */
async function runCommand(win, text) {
  const box = win.locator('textarea[placeholder^="Message your agent"]')
  await box.fill(`${text} `)
  await box.press('Enter')

  const allow = allowButton(win)
  await allow.waitFor({ timeout: 15_000 })
  const [request] = await win.evaluate(() => window.api.permission.pending())
  if (!request) throw new Error('the approval card rendered but main has no pending request')
  await allow.click()
  // 승인 카드도 입력 JSON 을 <pre> 로 그린다 — 사라지기를 기다린 뒤에 결과를 읽어야
  // 엉뚱한 <pre> 를 파싱하지 않는다.
  await allow.waitFor({ state: 'detached', timeout: 15_000 })

  const body = win.locator('pre')
  await body.waitFor({ timeout: 15_000 })
  const result = JSON.parse(await body.innerText())
  await box.press('Escape')
  return { title: request.title, result }
}

const ids = (app) => app.workspaces.map((w) => w.id)

export default async function 옆_워크스페이스를_정리하고_자기_자신도_접는다() {
  await withScratchRepo(
    { worktrees: [CALLER, VICTIM, VIEWED], seed: seedCallerAndVictims },
    async (scratch) => {
      const wooi = await launchWooi({ appDir: process.cwd(), ...scratch })
      const { win } = wooi
      try {
        await row(win, CALLER).click()
        await win.locator('.workspace-header').waitFor()

        // 1. 남이 만든, 게다가 **깨끗하지 않은** 워크스페이스를 지목한다. 예전이라면 두 번
        //    거절당했다(만든 사람이 아니라서, 미커밋 변경이 있어서). 지금은 대신 카드가 뜨고
        //    무엇을 잃는지 거기에 적힌다 — 호출자가 fullAccess 인데도 뜬다는 것이 이 절의 요점이다.
        const archive = await runCommand(win, `/wooi:archive ws-${VICTIM}`)
        if (archive.result.archived?.workspaceId !== `ws-${VICTIM}`) {
          throw new Error(`archive did not report the target: ${JSON.stringify(archive.result)}`)
        }
        if (!archive.title.includes(VICTIM) || !/archive/i.test(archive.title)) {
          throw new Error(
            `archive card did not name the workspace: ${JSON.stringify(archive.title)}`
          )
        }
        if (!/1 uncommitted file/.test(archive.title)) {
          throw new Error(
            `archive card did not count what is lost: ${JSON.stringify(archive.title)}`
          )
        }
        const archived = (await state(win)).workspaces.find((w) => w.id === `ws-${VICTIM}`)
        if (!archived?.archived) {
          throw new Error(`target was not archived: ${JSON.stringify(archived)}`)
        }
        // 아카이브는 되돌릴 수 있다 — 목록에서 사라지지 않고 Archived 로 접힌다.
        await win
          .getByText(/^Archived/)
          .first()
          .waitFor()
        console.log(`[e2e] screenshot=${await wooi.shot('archive-other')}`)

        // 2. 자기 자신은 **지금** 접지 않는다. 아카이브의 첫 걸음이 이 호출의 결과가 돌아갈
        //    세션을 죽이므로 예약만 하고, 실제 파괴는 턴이 끝날 때다. e2e 에는 끝날 턴이
        //    없으니 워크스페이스는 그대로 살아 있어야 한다.
        const self = await runCommand(win, '/wooi:archive')
        if (self.result.scheduled?.workspaceId !== 'ws-e2e') {
          throw new Error(`self-archive was not scheduled: ${JSON.stringify(self.result)}`)
        }
        if (!/archive this workspace/i.test(self.title)) {
          throw new Error(
            `self-archive card did not say it is this one: ${JSON.stringify(self.title)}`
          )
        }
        if ((await state(win)).workspaces.find((w) => w.id === 'ws-e2e')?.archived) {
          throw new Error('self-archive ran during the call instead of waiting for the turn to end')
        }
        console.log(`[e2e] screenshot=${await wooi.shot('archive-self')}`)

        // 3. 이미 아카이브된 것을 영구 삭제한다 — 사용자가 가장 흔하게 하는 정리이고, 아카이브
        //    도구는 거절하는 상태(이미 아카이브됨)가 여기서는 전제다. 아카이브가 되돌릴 수 있는
        //    것과 달리 이쪽은 목록에서 통째로 사라져야 한다.
        const removed = await runCommand(win, `/wooi:delete ws-${VICTIM}`)
        if (removed.result.deleted?.workspaceId !== `ws-${VICTIM}`) {
          throw new Error(`delete did not report the target: ${JSON.stringify(removed.result)}`)
        }
        if (!/cannot be undone/i.test(removed.title)) {
          throw new Error(`delete card did not say it is final: ${JSON.stringify(removed.title)}`)
        }
        const afterDelete = await state(win)
        if (ids(afterDelete).includes(`ws-${VICTIM}`)) {
          throw new Error(`deleted workspace is still in the store: ${ids(afterDelete).join(',')}`)
        }
        console.log(`[e2e] screenshot=${await wooi.shot('delete-other')}`)

        // 4. 보고 있던 워크스페이스가 통째로 사라지면 화면은 Overview 로 물러나야 한다.
        //
        //    지금까지 워크스페이스는 렌더러가 시작한 삭제로만 사라졌고, 그 경로는 스스로 선택을
        //    옮긴다. 에이전트 삭제가 처음으로 **메인이 먼저 없애는** 길을 만들었다 — 그때 선택이
        //    없는 id 를 가리킨 채 남으면 화면이 빈다.
        //
        //    카드는 언제나 **호출자**의 대화창에 그려지므로, 지울 워크스페이스를 보고 있는
        //    상태에서는 눌러서 답할 수가 없다. 그래서 도구는 호출자 id 로 부르고 승인은 Allow
        //    버튼과 같은 IPC 로 보낸다 — 메인 쪽 동작은 그대로 두고 화면만 victim 에 남긴다.
        await row(win, VIEWED).click()
        await win.locator('.workspace-header').waitFor()

        // 결과를 기다리는 promise 는 승인 전에는 매달려 있다. 떠 있는 거절이 프로세스를
        // 통째로 죽이지 않도록 결과를 먼저 붙잡아 둔다.
        let settled = null
        const pending = win
          .evaluate((id) => window.api.commands.wooiRun('ws-e2e', 'delete', id), `ws-${VIEWED}`)
          .then(
            (value) => (settled = { value }),
            (error) => (settled = { error })
          )

        // 카드는 호출자 쪽에 떴으므로 화면에는 없다. 메인이 요청을 들고 있는지로 기다린다.
        for (let i = 0; i < 60; i++) {
          const list = await win.evaluate(() => window.api.permission.pending())
          if (list.length > 0) break
          if (settled?.error) throw new Error(`delete call failed early: ${settled.error}`)
          await win.waitForTimeout(250)
        }
        const approved = await win.evaluate(async () => {
          const [request] = await window.api.permission.pending()
          if (!request) return null
          await window.api.permission.respond(request.requestId, { behavior: 'allow' })
          return request.title
        })
        if (!approved) throw new Error('no approval request arrived for the viewed workspace')
        await pending
        if (settled?.error || settled?.value?.error) {
          throw new Error(`delete of the viewed workspace failed: ${JSON.stringify(settled)}`)
        }

        await win.locator('.workspace-header').waitFor({ state: 'detached', timeout: 15_000 })
        const afterViewed = await state(win)
        if (ids(afterViewed).includes(`ws-${VIEWED}`)) {
          throw new Error(`viewed workspace survived deletion: ${ids(afterViewed).join(',')}`)
        }
        console.log(`[e2e] screenshot=${await wooi.shot('delete-while-viewing')}`)

        await waitForInspection(win)
      } finally {
        await wooi.close()
      }
    }
  )
}
