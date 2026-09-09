import { useEffect } from 'react'

/**
 * 얹은 웹 뷰를 가려야 할 때 그 사실을 등록하는 자리.
 *
 * `WebContentsView` 는 네이티브라 **항상 DOM 위에** 그려진다. 모달·토스트·팝오버가 뷰 영역과
 * 겹치면 그대로 뷰 아래로 사라져, 사용자는 "앱이 멈췄다" 고 느낀다.
 *
 * 중앙에 "지금 뭔가 떠 있나" 목록을 두지 않는 것이 요점이다. 그런 목록은 반드시 샌다 — 실제로
 * `store.overlayOpen` 이 그렇게 새고 있고(ConfirmDialog·Toaster·컨텍스트 메뉴·팝오버가 빠져
 * 있으며 분리 창은 갱신조차 하지 않는다), 새로 뜬 오버레이를 목록에 넣는 것을 잊기 쉽다.
 * 대신 **오버레이 자신이 마운트하면서 가림을 획득**하게 뒤집는다. `Modal` 을 쓰는 것만으로
 * 상속되므로, 나중에 추가되는 모달은 아무것도 안 해도 맞게 동작한다.
 *
 * `store` 가 아니라 모듈 레지스트리인 이유: 이 값을 읽는 것은 프레임 루프 하나뿐이라
 * 리렌더가 필요 없다. 스토어에 넣으면 토스트가 뜰 때마다 앱 전체가 다시 그려진다.
 */

/** 화면 전체를 덮는 오버레이의 수. 하나라도 있으면 모든 뷰를 숨긴다. */
let fullCount = 0
/** 자기 사각형과 겹치는 뷰만 숨기는 오버레이들. */
const rects = new Set<HTMLElement>()

/**
 * 뷰를 전부 숨긴다 — 모달·확인 대화상자·파일 뷰어·기능 투어처럼 화면을 덮는 것들.
 * 반환한 함수를 부르면 해제한다.
 */
export function suppressAllViews(): () => void {
  fullCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    fullCount = Math.max(0, fullCount - 1)
  }
}

/**
 * 이 요소와 **겹치는** 뷰만 숨긴다 — 토스트·드롭다운·툴팁처럼 화면 한 귀퉁이만 덮는 것들.
 *
 * 토스트가 이쪽이어야 하는 이유가 결정적이다: `fixed bottom-4 right-4` 는 작업 패널과 정확히
 * 겹치는데, 토스트 하나 뜰 때마다 dev 프리뷰 전체를 깜빡이게 할 수는 없다.
 */
export function suppressViewsOver(el: HTMLElement): () => void {
  rects.add(el)
  return () => {
    rects.delete(el)
  }
}

/** 이 사각형이 지금 가려져 있는가. 프레임 루프가 뷰마다 묻는다. */
export function isViewSuppressed(box: DOMRect): boolean {
  if (fullCount > 0) return true
  for (const el of rects) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const overlaps =
      r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top
    if (overlaps) return true
  }
  return false
}

/** 마운트되어 있는 동안 모든 뷰를 숨긴다. */
export function useSuppressAllViews(active = true): void {
  useEffect(() => {
    if (!active) return
    return suppressAllViews()
  }, [active])
}

/** 마운트되어 있는 동안 이 요소와 겹치는 뷰를 숨긴다. */
export function useSuppressViewsOver(ref: { current: HTMLElement | null }, active = true): void {
  useEffect(() => {
    const el = ref.current
    if (!active || !el) return
    return suppressViewsOver(el)
  }, [ref, active])
}

/** 테스트용 초기화 — 모듈 상태가 케이스 사이에 새지 않게 한다. */
export function resetViewSuppression(): void {
  fullCount = 0
  rects.clear()
}
