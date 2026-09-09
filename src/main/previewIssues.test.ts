import { EventEmitter } from 'node:events'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'

// initSession()/webRequest 는 이 테스트가 쓰지 않는다 — watch()/clear()/list() 만 검증한다.
vi.mock('electron', () => ({
  session: {
    fromPartition: () => ({ webRequest: { onErrorOccurred: vi.fn(), onCompleted: vi.fn() } })
  }
}))
vi.mock('./logger', () => ({ log: { error: vi.fn() } }))

import { PreviewIssueCollector } from './previewIssues'

/**
 * `console-message`/`did-navigate`/`destroyed` 만 필요한 최소 가짜 게스트.
 * previewIssues.ts 는 `guest.on`/`once`/`removeListener` 만 쓰므로 EventEmitter 로 충분하다.
 */
function fakeGuest(id: number): WebContents & EventEmitter {
  const emitter = new EventEmitter()
  return Object.assign(emitter, { id }) as unknown as WebContents & EventEmitter
}

/** console-message 로 에러 하나를 흘려 넣는다(메시지 필드는 첫 인자에 실린다). */
function emitConsoleError(guest: EventEmitter, text: string): void {
  guest.emit('console-message', {
    level: 'error',
    message: text,
    lineNumber: 1,
    sourceId: 'app.js'
  })
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('PreviewIssueCollector', () => {
  it('탭 A 의 did-navigate 가 탭 B 의 이슈를 지우지 않는다', () => {
    const collector = new PreviewIssueCollector(vi.fn())
    const guestA = fakeGuest(1)
    const guestB = fakeGuest(2)

    // 같은 워크스페이스의 두 탭 — 이게 이번 재키잉 전에는 같은 키(workspaceId)로 뭉쳤다.
    collector.watch('tab-a', 'ws-1', guestA)
    collector.watch('tab-b', 'ws-1', guestB)

    emitConsoleError(guestA, 'boom in A')
    emitConsoleError(guestB, 'boom in B')
    expect(collector.list('tab-a')).toHaveLength(1)
    expect(collector.list('tab-b')).toHaveLength(1)

    // 탭 A 가 새 페이지로 이동한다 — 탭 A 의 문제만 접어야 한다.
    guestA.emit('did-navigate')

    expect(collector.list('tab-a')).toHaveLength(0)
    expect(collector.list('tab-b')).toHaveLength(1)
    expect(collector.list('tab-b')[0].text).toBe('boom in B')
  })

  it('unwatch 는 리스너만 떼고 모아 둔 문제는 남긴다 — 뷰가 캐시에서 축출됐다 되살아나는 경우다', () => {
    const collector = new PreviewIssueCollector(vi.fn())
    const guest = fakeGuest(1)
    collector.watch('tab-a', 'ws-1', guest)
    emitConsoleError(guest, 'boom')

    collector.unwatch('tab-a')

    expect(collector.list('tab-a')).toHaveLength(1)
    // 리스너가 떨어졌으니 더 emit 해도 늘지 않는다.
    emitConsoleError(guest, 'after unwatch')
    expect(collector.list('tab-a')).toHaveLength(1)
  })

  it('disposeWorkspace 는 그 워크스페이스의 탭만 지우고 다른 워크스페이스는 남긴다', () => {
    const collector = new PreviewIssueCollector(vi.fn())
    const guestA = fakeGuest(1)
    const guestB = fakeGuest(2)
    const guestC = fakeGuest(3)
    collector.watch('tab-a', 'ws-1', guestA)
    collector.watch('tab-b', 'ws-1', guestB)
    collector.watch('tab-c', 'ws-2', guestC)
    emitConsoleError(guestA, 'a')
    emitConsoleError(guestB, 'b')
    emitConsoleError(guestC, 'c')

    collector.disposeWorkspace('ws-1')

    expect(collector.list('tab-a')).toHaveLength(0)
    expect(collector.list('tab-b')).toHaveLength(0)
    expect(collector.list('tab-c')).toHaveLength(1)
  })

  it('개수 방송은 tabId 와 workspaceId 를 함께 싣는다', () => {
    const dispatch = vi.fn()
    const collector = new PreviewIssueCollector(dispatch)
    const guest = fakeGuest(1)
    collector.watch('tab-a', 'ws-1', guest)

    emitConsoleError(guest, 'boom')
    vi.advanceTimersByTime(500)

    expect(dispatch).toHaveBeenCalledWith('evt:previewIssues', {
      tabId: 'tab-a',
      workspaceId: 'ws-1',
      errors: 1,
      warnings: 0
    })
  })

  it('countIssues 는 그 탭의 에러/경고 개수만 센다', () => {
    const collector = new PreviewIssueCollector(vi.fn())
    const guestA = fakeGuest(1)
    const guestB = fakeGuest(2)
    collector.watch('tab-a', 'ws-1', guestA)
    collector.watch('tab-b', 'ws-1', guestB)
    emitConsoleError(guestA, 'a1')
    emitConsoleError(guestA, 'a2')
    emitConsoleError(guestB, 'b1')

    expect(collector.countIssues('tab-a')).toEqual({ errors: 2, warnings: 0 })
    expect(collector.countIssues('tab-b')).toEqual({ errors: 1, warnings: 0 })
  })
})
