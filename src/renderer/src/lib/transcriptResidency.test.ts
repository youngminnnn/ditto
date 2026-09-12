import { describe, expect, it } from 'vitest'
import { MAX_RESIDENT_TRANSCRIPTS, pickEvictableTranscripts } from './transcriptResidency'

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `ws-${i}`)

/** 만든 순서대로 오래된 것이 되도록 시각을 매긴다. */
const touched = (list: readonly string[]): Record<string, number> =>
  Object.fromEntries(list.map((id, i) => [id, i + 1]))

describe('pickEvictableTranscripts', () => {
  it('상한 아래면 아무것도 놓지 않는다 — 상한은 목표치가 아니라 발동 조건이다', () => {
    const resident = ids(MAX_RESIDENT_TRANSCRIPTS)
    expect(
      pickEvictableTranscripts({
        touchedAt: touched(resident),
        resident,
        protectedIds: new Set()
      })
    ).toEqual([])
  })

  it('넘친 만큼만, 오래 안 쓴 것부터 놓는다', () => {
    const resident = ids(MAX_RESIDENT_TRANSCRIPTS + 2)
    expect(
      pickEvictableTranscripts({
        touchedAt: touched(resident),
        resident,
        protectedIds: new Set()
      })
    ).toEqual(['ws-0', 'ws-1'])
  })

  it('보호 대상은 아무리 오래됐어도 후보가 아니다 — 보던 대화가 사라지면 버그로 읽힌다', () => {
    const resident = ids(MAX_RESIDENT_TRANSCRIPTS + 2)
    expect(
      pickEvictableTranscripts({
        touchedAt: touched(resident),
        resident,
        protectedIds: new Set(['ws-0'])
      })
    ).toEqual(['ws-1', 'ws-2'])
  })

  it('후보가 모자라면 있는 만큼만 놓는다 — 상한을 지키려고 보호 대상을 깨지 않는다', () => {
    const resident = ids(MAX_RESIDENT_TRANSCRIPTS + 3)
    const protectedIds = new Set(resident.slice(0, resident.length - 1))
    expect(
      pickEvictableTranscripts({ touchedAt: touched(resident), resident, protectedIds })
    ).toEqual([resident[resident.length - 1]])
  })

  it('시각을 모르는 워크스페이스가 가장 먼저다 — 쓴 적이 기록되지 않은 것은 열어 본 적이 없다', () => {
    const resident = ids(MAX_RESIDENT_TRANSCRIPTS + 1)
    const touchedAt = touched(resident)
    delete touchedAt['ws-5']
    expect(pickEvictableTranscripts({ touchedAt, resident, protectedIds: new Set() })).toEqual([
      'ws-5'
    ])
  })
})
