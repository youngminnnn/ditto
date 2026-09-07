import { useEffect, useState } from 'react'

/** 문서가 지금 화면에 그려지고 있는가(최소화·다른 Space·숨김이면 false). */
function documentVisible(): boolean {
  return document.visibilityState === 'visible'
}

/**
 * 일정 간격으로 현재 시각(epoch ms)을 갱신해 리렌더를 유발하는 훅.
 * 실행 중 세션의 경과 시간처럼 "흐르는" 표시를 위해 사용한다.
 * @param intervalMs 갱신 주기(기본 1초). active 가 false 면 타이머를 돌리지 않는다.
 *
 * 문서가 보이지 않는 동안에는 active 여도 타이머를 멈춘다 — 백그라운드에서 매초 리렌더를
 * 돌릴 이유가 없다. 다시 보이면 즉시 값을 한 번 갱신해 굳어 있던 시각이 바로 따라잡는다.
 */
export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const tick = (): void => setNow(Date.now())
    tick()
    let id: ReturnType<typeof setInterval> | null = null
    const start = (): void => {
      if (id != null) return
      id = setInterval(tick, intervalMs)
    }
    const stop = (): void => {
      if (id == null) return
      clearInterval(id)
      id = null
    }
    const onVisibilityChange = (): void => {
      if (documentVisible()) {
        tick()
        start()
      } else {
        stop()
      }
    }
    if (documentVisible()) start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stop()
    }
  }, [intervalMs, active])
  return now
}
