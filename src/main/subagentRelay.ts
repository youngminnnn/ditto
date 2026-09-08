import type { ChatItem } from '@shared/types'

/**
 * 사용자가 서브에이전트에게 건 말을 부모를 거쳐 전하기 위한 두 조각.
 *
 * 왜 릴레이인가 — Agent SDK 는 호스트에게 서브에이전트로 가는 채널을 주지 않는다. `Query` 가 가진
 * 것은 `stopTask` 하나뿐이고, 받는 쪽 inbox 에 메시지를 넣는 `SendMessage` 는 **모델이 부르는
 * 도구**다. 그래서 우리가 할 수 있는 것은 부모에게 "대신 전해 달라" 고 시키는 일뿐이다.
 *
 * IPC 핸들러에서 떼어 둔 이유는 문구가 이 기능의 실질이기 때문이다. 무엇을 못박느냐에 따라 부모가
 * 전달하는 대신 자기가 일해 버리기도 한다 — 그 판단은 테스트로 고정할 값어치가 있고, Electron
 * 없이 확인할 수 있어야 한다.
 */

/**
 * 사용자의 말이 화면에 남는 자리 — **그 서브에이전트의 대화**다.
 *
 * 실제 전달 경로는 부모를 거치지만, 사용자가 친 곳과 남는 곳이 어긋나면 자기가 보낸 말을 찾을 수
 * 없다. `parentToolId` 가 그 자리를 정한다([[shared/subagents]]).
 */
export function relayedUserItem(toolId: string, text: string, ts: number): ChatItem {
  return { id: `subagent-msg:${toolId}:${ts}`, type: 'user', text, ts, parentToolId: toolId }
}

/**
 * 부모에게 넘길 릴레이 지시문.
 *
 * 두 가지를 못박는 것이 전부다. **그대로 전할 것**과 **네가 대신 하지 말 것**. 두 번째가 없으면
 * 모델은 친절하게도 그 일을 자기가 해 버린다 — 사용자가 고른 상대는 그 서브에이전트이고, 부모가
 * 대신 답하면 고른 의미가 사라진다.
 *
 * `address` 는 SDK 의 task id 다 — 부모가 `ListAgents` 로 보는 주소가 정확히 그 값이라는 것을
 * 실물로 확인했다([[shared/subagents]] subagentAddress). Agent 도구에 `name` 파라미터가 없어
 * 이름은 붙일 수가 없다.
 *
 * 사용자의 말은 따옴표가 아니라 구분선 안에 넣는다. 따옴표로 감싸면 사용자가 따옴표를 쓴 순간
 * 경계가 무너진다.
 */
export function relayPrompt(address: string, text: string): string {
  return [
    `The user is looking at your running subagent whose agent id is ${address}, and sent it this`,
    `message. Relay it verbatim with SendMessage({to: "${address}"}). Do not answer it yourself`,
    'and do not do the work — it was addressed to that subagent, not to you. If the id is not',
    'addressable, call ListAgents to find the right one and use that. If it still cannot be',
    'delivered, say so plainly and stop.',
    '',
    '--- message ---',
    text,
    '--- end message ---'
  ].join('\n')
}

/** 부모 대화에서 이 턴이 무엇이었는지 알려 주는 접힌 한 줄([[types]] WooiTurnOrigin). */
export function relayOriginLabel(address: string): string {
  return `Relaying a message to subagent ${address}`
}
