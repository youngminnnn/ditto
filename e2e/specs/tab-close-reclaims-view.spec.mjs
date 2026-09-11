/* global console, process */

import { openSeededWorkspace, seedAppState, waitForInspection } from '../fixtures.mjs'
import { launchWooi, withScratchRepo } from '../harness.mjs'

/** 웹 탭 게스트가 사는 파티션. 파티션이 곧 신원이다([[main/webViews]] partitionFor). */
const BROWSER_PARTITION = 'persist:wooi-browser'

/**
 * 탭을 닫으면 그 뷰의 렌더러 프로세스가 실제로 사라지는지 잰다.
 *
 * 단위 테스트로는 여기까지 못 본다. `HostedViewManager` 는 자기 맵에서 항목을 지웠다고 말할
 * 수 있을 뿐이고, 정작 문제가 됐던 것은 **맵에는 남아 있는데 아무도 지목할 수 없는 뷰**였다 —
 * 탭 레코드가 먼저 사라져서. 게다가 그 뷰를 거둬 갔어야 할 두 장치(6개 예산·10분 동면 스윕)는
 * `visible` 이 true 로 굳는 바람에 둘 다 후보 목록에서 그 뷰를 빼고 있었고, 그 상태가 기존
 * 단위 테스트를 그대로 통과했다. 그러니 "정말로 프로세스가 없어졌는가" 는 실제 앱에서
 * webContents 를 세어 보는 수밖에 없다.
 */
export default async function 탭을_닫으면_뷰가_회수된다() {
  await withScratchRepo(
    { worktrees: ['feature-test'], seed: (scratch) => seedAppState(scratch) },
    async (scratch) => {
      const wooi = await launchWooi({ appDir: process.cwd(), ...scratch })
      try {
        await openSeededWorkspace(wooi.win)

        // 주소는 넣지 않는다. 빈 웹 탭도 게스트를 세우므로 네트워크 없이 이 동작을 잴 수 있다.
        const newTab = wooi.win.getByRole('button', { name: 'New tab' })
        await newTab.waitFor()
        await newTab.click()
        const newWebTab = wooi.win.getByRole('button', { name: 'New web tab' })
        await newWebTab.waitFor()
        await newWebTab.click()

        const opened = await untilGuests(
          wooi,
          (n) => n === 1,
          '웹 탭을 열어도 게스트가 서지 않았다'
        )

        // 탭을 닫는다. 주소 없는 웹 탭의 라벨은 종류 이름 그대로다(TabStrip 의 tabLabel).
        const close = wooi.win.getByRole('button', { name: 'Close web' })
        await close.waitFor()
        await close.click()

        const remaining = await untilGuests(
          wooi,
          (n) => n === 0,
          '탭을 닫았는데 게스트 webContents 가 남아 있다 — 뷰가 회수되지 않았다'
        )

        const screenshot = await wooi.shot('tab-close-reclaims-view')
        console.log(
          `[e2e] guests opened=${opened} afterClose=${remaining} screenshot=${screenshot}`
        )
        await waitForInspection(wooi.win)
      } finally {
        await wooi.close()
      }
    }
  )
}

/** 브라우저 파티션의 살아 있는 게스트 수가 조건을 만족할 때까지 기다린다. */
async function untilGuests(wooi, predicate, message) {
  let seen = -1
  for (let attempt = 0; attempt < 40; attempt++) {
    seen = await wooi.app.evaluate(async ({ webContents, session }, partition) => {
      const guests = session.fromPartition(partition)
      return webContents
        .getAllWebContents()
        .filter((wc) => !wc.isDestroyed() && wc.session === guests).length
    }, BROWSER_PARTITION)
    if (predicate(seen)) return seen
    await wooi.win.waitForTimeout(250)
  }
  throw new Error(`${message} (마지막으로 본 게스트 수: ${seen})`)
}
