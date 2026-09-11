/* global console, process */

import { openSeededWorkspace, seedAppState, waitForInspection } from '../fixtures.mjs'
import { launchWooi, withScratchRepo } from '../harness.mjs'

/**
 * `+` 는 탭 줄의 맨 오른쪽, 즉 창의 오른쪽 가장자리 바로 안쪽에 있다. 드롭다운을 버튼의 왼쪽
 * 모서리 기준으로 펴면 패널 폭만큼이 창 밖으로 나가 잘리고 — 항목의 아이콘만 남아 보인다.
 * 단위 테스트는 클래스 이름까지만 볼 수 있으므로, 실제로 창 안에 들어오는지는 여기서 잰다.
 */
export default async function 새_탭_메뉴는_창_안에_들어온다() {
  await withScratchRepo(
    { worktrees: ['feature-test'], seed: (scratch) => seedAppState(scratch) },
    async (scratch) => {
      const wooi = await launchWooi({ appDir: process.cwd(), ...scratch })
      try {
        await openSeededWorkspace(wooi.win)

        const newTab = wooi.win.getByRole('button', { name: 'New tab' })
        await newTab.waitFor()
        await newTab.click()

        const item = wooi.win.getByRole('button', { name: 'New web tab' })
        await item.waitFor()

        const layout = await item.evaluate((button) => {
          const panel = button.parentElement
          if (!panel) throw new Error('new tab menu panel was not rendered')
          const p = panel.getBoundingClientRect()
          const b = button.getBoundingClientRect()
          return {
            viewportWidth: globalThis.innerWidth,
            panelLeft: p.left,
            panelRight: p.right,
            panelWidth: p.width,
            itemRight: b.right
          }
        })

        // 오른쪽으로 넘치면 잘리고, 왼쪽으로 넘쳐도 마찬가지다. 양쪽 다 본다.
        if (layout.panelRight > layout.viewportWidth || layout.panelLeft < 0) {
          throw new Error(`new tab menu was clipped by the window: ${JSON.stringify(layout)}`)
        }
        // 패널이 창 안에 있어도 항목이 패널 밖으로 나가면 라벨이 잘린다.
        if (layout.itemRight > layout.panelRight) {
          throw new Error(`menu item overflowed its panel: ${JSON.stringify(layout)}`)
        }

        const screenshot = await wooi.shot('tab-strip-new-tab-menu')
        console.log(`[e2e] layout=${JSON.stringify(layout)} screenshot=${screenshot}`)
        await waitForInspection(wooi.win)
      } finally {
        await wooi.close()
      }
    }
  )
}
