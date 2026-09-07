/* global console, process */

import { openSeededWorkspace, seedAppState, waitForInspection } from '../fixtures.mjs'
import { launchWooi, withScratchRepo } from '../harness.mjs'

/**
 * Agents 패널 — 서브에이전트마다 자기 대화를 따로 열어 본다.
 *
 * 렌더러 단위 테스트가 이미 "언제 펼쳐지고 무엇이 섞이지 않는가" 를 증명한다. 여기서 볼 것은
 * 그 판정이 아니라 **판정을 감싸는 배선**이다:
 *
 * - 디스크에 저장된 `subagent`/`parentToolId` 항목이 실제로 다시 읽혀 패널의 행이 되는가.
 *   (이 설계의 전제가 "트랜스크립트에 함께 저장하므로 껐다 켜도 남는다" 이고, 그 전제는 진짜
 *   앱을 띄워 파일에서 읽어 봐야만 증명된다.)
 * - 부모 대화가 서브에이전트의 도구 호출을 **걸러 내는가**. 이 배선이 끊기면 예전처럼 Task 카드
 *   사이에 남의 Bash·Read 가 섞인다.
 * - 사이드바가 아니라 우상단 탭에 있으므로, 탭 배선(라벨·전환·배지)이 함께 확인된다.
 */
const PARENT_TEXT = 'Delegating the search to two agents.'
const CHILD_ONE_TEXT = 'Found the config loader in src/main/paths.ts'
const CHILD_TWO_TEXT = 'The branch rule lives in scripts/branch-name-rule.mjs'
const CHILD_BASH = 'rg --files-with-matches loadConfig'

export default async function 서브에이전트의_대화는_Agents_탭에서_따로_열린다() {
  const now = Date.now()
  const transcript = [
    {
      id: 'user-1',
      type: 'user',
      text: 'find the config loader and the branch rule',
      ts: now - 20
    },

    // 부모가 두 명에게 위임한다. 이 두 카드는 대화에 남아야 한다 — "누구에게 무엇을 시켰다" 는
    // 여전히 대화의 일부다.
    {
      id: 'use-agent-1',
      type: 'tool_use',
      name: 'Agent',
      input: { subagent_type: 'Explore', description: 'Find the config loader' },
      toolId: 'toolu_one',
      ts: now - 19
    },
    {
      id: 'use-agent-2',
      type: 'tool_use',
      name: 'Agent',
      input: { subagent_type: 'Explore', description: 'Find the branch rule' },
      toolId: 'toolu_two',
      ts: now - 18
    },

    // 패널의 행. 하나는 아직 돌고 있고(펼쳐진다), 하나는 끝났다(접힌다).
    {
      id: 'subagent:toolu_one',
      type: 'subagent',
      toolId: 'toolu_one',
      taskId: 'task-one',
      backend: 'claude',
      agentType: 'Explore',
      description: 'Find the config loader',
      status: 'running',
      toolUses: 4,
      totalTokens: 18_400,
      ts: now - 19
    },
    {
      id: 'subagent:toolu_two',
      type: 'subagent',
      toolId: 'toolu_two',
      backend: 'claude',
      agentType: 'Explore',
      description: 'Find the branch rule',
      status: 'completed',
      toolUses: 7,
      totalTokens: 31_200,
      durationMs: 42_000,
      ts: now - 18
    },

    // 두 서브에이전트의 대화. 부모 대화에는 한 줄도 나오면 안 된다.
    {
      id: 'child-1-bash',
      type: 'tool_use',
      name: 'Bash',
      input: { command: CHILD_BASH },
      toolId: 'toolu_child_bash',
      ts: now - 17,
      parentToolId: 'toolu_one'
    },
    {
      id: 'child-1-bash-res',
      type: 'tool_result',
      toolId: 'toolu_child_bash',
      text: 'src/main/paths.ts',
      isError: false,
      ts: now - 16,
      parentToolId: 'toolu_one'
    },
    {
      id: 'child-1-say',
      type: 'assistant',
      text: CHILD_ONE_TEXT,
      ts: now - 15,
      parentToolId: 'toolu_one'
    },
    {
      id: 'child-2-say',
      type: 'assistant',
      text: CHILD_TWO_TEXT,
      ts: now - 14,
      parentToolId: 'toolu_two'
    },

    { id: 'parent-say', type: 'assistant', text: PARENT_TEXT, ts: now - 13 }
  ]

  await withScratchRepo(
    {
      worktrees: ['feature-subagents'],
      seed: (scratch) => seedAppState(scratch, { transcript })
    },
    async (scratch) => {
      const wooi = await launchWooi({ appDir: process.cwd(), ...scratch })
      try {
        await openSeededWorkspace(wooi.win)

        // ── 부모 대화 ────────────────────────────────────────────────────
        const body = await wooi.win.locator('body').innerText()

        if (!body.includes(PARENT_TEXT)) {
          throw new Error(`parent reply is missing from the conversation:\n${body.slice(0, 2000)}`)
        }
        // 이것이 이 변경의 핵심 계약이다 — 서브에이전트가 낸 것은 부모 대화에 나오지 않는다.
        for (const leaked of [CHILD_ONE_TEXT, CHILD_TWO_TEXT, CHILD_BASH]) {
          if (body.includes(leaked)) {
            throw new Error(`subagent output leaked into the parent conversation: ${leaked}`)
          }
        }

        // ── Agents 탭 ────────────────────────────────────────────────────
        // 이름으로 잡으면 사이드바의 "Running 2 agents" 접기 버튼과 부딪힌다 — 탭은 title 로.
        const tab = wooi.win.locator('button[title="Agents"]')
        await tab.waitFor()
        await tab.click()

        const panel = await wooi.win.locator('body').innerText()
        if (!panel.includes('Find the config loader') || !panel.includes('Find the branch rule')) {
          throw new Error(`both subagent rows should be listed:\n${panel.slice(0, 2000)}`)
        }
        // 도는 중인 것은 펼쳐져 있고, 끝난 것은 접혀 있다.
        if (!panel.includes(CHILD_ONE_TEXT)) {
          throw new Error(`the running subagent should be expanded:\n${panel.slice(0, 2000)}`)
        }
        if (panel.includes(CHILD_TWO_TEXT)) {
          throw new Error(`the finished subagent should be collapsed:\n${panel.slice(0, 2000)}`)
        }
        // 그리고 도는 중인 것만 중지할 수 있다.
        const stops = await wooi.win.getByRole('button', { name: /^Stop subagent/ }).count()
        if (stops !== 1) throw new Error(`expected exactly one stop button, saw ${stops}`)

        console.log(`[e2e] screenshot=${await wooi.shot('subagents-panel')}`)

        // 끝난 것을 펼치면 그 대화가 나온다.
        await wooi.win.locator('[data-item-id="subagent:toolu_two"] button[aria-expanded]').click()
        const expanded = await wooi.win.locator('body').innerText()
        if (!expanded.includes(CHILD_TWO_TEXT)) {
          throw new Error(
            `expanding the finished subagent should reveal its conversation:\n${expanded.slice(0, 2000)}`
          )
        }
        console.log(`[e2e] screenshot=${await wooi.shot('subagents-panel-expanded')}`)

        await waitForInspection(wooi.win)
      } finally {
        await wooi.close()
      }
    }
  )
}
