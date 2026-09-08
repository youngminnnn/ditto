import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { relayOriginLabel, relayPrompt, relayedUserItem } from './subagentRelay'

describe('서브에이전트 릴레이', () => {
  it('사용자의 말은 그 서브에이전트의 대화에 남는다', () => {
    // 부모를 거쳐 전달되더라도 화면에 남는 자리는 사용자가 보고 있던 대화여야 한다 — 친 곳과
    // 남는 곳이 어긋나면 자기가 보낸 말을 찾을 수 없다.
    const item = relayedUserItem('toolu_1', 'check the loader again', 1000)
    expect(item).toMatchObject({
      type: 'user',
      text: 'check the loader again',
      parentToolId: 'toolu_1'
    })
  })

  it('지시문은 전달할 상대와 "네가 하지 마라"를 함께 못박는다', () => {
    const prompt = relayPrompt('explorer', 'look again')
    expect(prompt).toContain('SendMessage({to: "explorer"})')
    // 이 문장이 없으면 모델은 친절하게도 그 일을 자기가 해 버린다. 릴레이의 실질이 여기 있다.
    expect(prompt).toMatch(/Do not answer it yourself/)
    expect(prompt).toMatch(/do not do\s+the work/)
  })

  it('사용자의 말은 구분선 안에 그대로 실린다', () => {
    // 따옴표로 감싸면 사용자가 따옴표를 쓰는 순간 경계가 무너진다.
    const prompt = relayPrompt('explorer', 'he said "stop" — then quit')
    expect(prompt).toContain('--- message ---\nhe said "stop" — then quit\n--- end message ---')
  })

  /**
   * 릴레이는 **부모의 턴을 하나 쓴다.** 그 턴을 감추면(silent) 사용자는 자기 토큰이 어디에 쓰였는지
   * 대화만 보고 알 수 없다 — 이 저장소의 규약은 "감추지 않고 접는다" 다([[types]] WooiTurnOrigin).
   * 배선은 Electron 없이 실행할 수 없으므로 소스로 확인한다(ipc.test.ts 와 같은 방식).
   */
  it('릴레이 턴을 부모 대화에서 감추지 않는다', () => {
    const source = readFileSync(join(import.meta.dirname, 'ipc.ts'), 'utf-8')
    const handler = source.slice(
      source.indexOf('IPC.chatSendToSubagent'),
      source.indexOf('handle(IPC.chatInterrupt')
    )
    expect(handler).toContain('relayOriginLabel')
    expect(handler).not.toContain('silent')
  })

  it('접힌 한 줄에 받는 이가 드러난다', () => {
    expect(relayOriginLabel('explorer')).toContain('explorer')
  })
})
