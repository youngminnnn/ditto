import type { ChatItem } from './types'

/**
 * 한 트랜스크립트 안에 섞여 있는 **서브에이전트의 대화**를 갈라내는 규칙.
 *
 * 서브에이전트 항목을 별도 저장소가 아니라 같은 JSONL 에 두는 것이 이 설계의 요점이다. 그래야
 * 앱을 껐다 켜도 끝난 서브에이전트의 대화가 그대로 살아나고, 검색·페이지네이션·되돌리기 같은
 * 기존 장치를 하나도 새로 만들지 않아도 된다. 대신 "누구의 말인가" 를 읽는 곳이 두 군데로
 * 갈리므로(부모 대화는 걸러 내고, Agents 패널은 골라 낸다) 그 판정을 여기 한 곳에 둔다.
 *
 * 판정 기준은 `parentToolId` 하나다 — 서브에이전트를 띄운 도구 호출의 id. Claude 네이티브 Task 는
 * SDK 의 `tool_use_id`, 위임 실행과 Codex collab 은 각자의 실행 id 를 싣는다.
 */

export type SubagentRow = Extract<ChatItem, { type: 'subagent' }>

/**
 * 이 항목이 부모 대화가 아니라 어느 서브에이전트의 대화에 속하는가.
 *
 * 패널의 행(`subagent`) 자체도 포함한다 — 그것도 부모 대화에 놓일 것이 아니다. 부모 대화에서
 * 그 실행을 가리키는 자리는 이미 `Task`/`Agent` 도구 카드가 맡고 있다.
 */
export function isSubagentItem(item: ChatItem): boolean {
  if (item.type === 'subagent') return true
  return 'parentToolId' in item && typeof item.parentToolId === 'string'
}

/**
 * 부모 대화에 놓을 항목만 남긴다.
 *
 * 서브에이전트가 하나도 없으면 **받은 배열을 그대로 돌려준다.** 대부분의 대화가 그렇고, 여기서
 * 매번 새 배열을 만들면 그 참조로 memo 를 거는 하위 계산(도구 묶음·체크리스트·검색 색인)이
 * 전부 다시 돈다.
 */
export function mainConversationItems(items: ChatItem[]): ChatItem[] {
  return items.some(isSubagentItem) ? items.filter((item) => !isSubagentItem(item)) : items
}

/** Agents 패널의 행들. 시작 순서(트랜스크립트 순서)를 그대로 둔다. */
export function subagentRows(items: readonly ChatItem[]): SubagentRow[] {
  return items.filter((item): item is SubagentRow => item.type === 'subagent')
}

/** 서브에이전트 한 명의 대화. 행 자체는 빼고 자식 항목만 준다. */
export function subagentChildren(items: readonly ChatItem[], toolId: string): ChatItem[] {
  return items.filter((item) => 'parentToolId' in item && item.parentToolId === toolId)
}

/** 지금 돌고 있는 서브에이전트 수. 사이드바 요약이 읽는다 — 0 이면 아무것도 그리지 않는다. */
export function runningSubagentCount(items: ChatItem[] | undefined): number {
  return subagentRows(items ?? []).filter((row) => row.status === 'running').length
}

/** 그 서브에이전트 행 하나. 없으면 null. */
export function subagentRow(items: readonly ChatItem[], toolId: string): SubagentRow | null {
  return subagentRows(items).find((row) => row.toolId === toolId) ?? null
}

/**
 * 이 서브에이전트에게 지금 말을 걸 수 있는가, 걸 수 있다면 어느 이름으로.
 *
 * ## 왜 이름이 필요한가
 *
 * Wooi 는 서브에이전트에게 **직접** 보낼 수 없다. Agent SDK 가 호스트에게 준 것은
 * `stopTask(taskId)` 하나뿐이고, 메시지를 넣는 `SendMessage` 는 **모델이 부르는 도구**다.
 * 그래서 보내기는 부모에게 대신 전해 달라고 시키는 릴레이가 되는데, 그 릴레이가 성립하려면
 * 받는 쪽에 **주소**가 있어야 한다 — Claude Code 의 Agent 도구가 그렇게 정의한다:
 * "Name for the spawned agent. Makes it addressable via SendMessage({to: name}) while running."
 *
 * 이름은 그 서브에이전트를 띄운 Task 도구 호출의 입력에 남아 있다. 우리가 따로 기록해 둘
 * 필요가 없고, 옛 대화를 다시 열어도 그대로 읽힌다.
 *
 * ## 왜 이유까지 돌려주는가
 *
 * 못 보내는 경우가 두 가지인데(이름 없이 떴다 · 이미 끝났다) 둘은 사용자가 할 수 있는 일이
 * 다르다. 입력창을 조용히 비활성만 시키면 어느 쪽인지 알 수 없어 고장으로 읽힌다.
 */
export type SubagentAddress =
  { canSend: true; name: string } | { canSend: false; reason: 'finished' | 'unnamed' }

export function subagentAddress(items: readonly ChatItem[], toolId: string): SubagentAddress {
  const row = subagentRow(items, toolId)
  if (!row || row.status !== 'running') return { canSend: false, reason: 'finished' }
  const name = spawnName(items, toolId)
  return name ? { canSend: true, name } : { canSend: false, reason: 'unnamed' }
}

/** 이 서브에이전트를 띄운 Task 도구 호출이 지어 준 이름(`Agent({name})`). 없으면 null. */
function spawnName(items: readonly ChatItem[], toolId: string): string | null {
  const use = items.find((item) => item.type === 'tool_use' && item.toolId === toolId)
  if (!use || use.type !== 'tool_use') return null
  const input = use.input
  if (typeof input !== 'object' || input === null) return null
  const name = (input as Record<string, unknown>).name
  return typeof name === 'string' && name.trim() ? name : null
}
