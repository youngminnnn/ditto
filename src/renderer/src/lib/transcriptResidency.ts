/**
 * 렌더러에 상주시킬 트랜스크립트의 상한과, 넘쳤을 때 무엇부터 놓을지.
 *
 * 메인은 같은 것을 이미 20개로 묶어 둔다([[main/transcripts]] CACHE_LIMIT). 렌더러에만
 * 상한이 없으면 워크스페이스를 오갈수록 힙이 한 방향으로만 자란다 — 전환도, 아카이브도,
 * 삭제도 놓아 주지 않기 때문이다. 게다가 채팅 이벤트는 지금 보고 있는 워크스페이스인지
 * 가리지 않고 쌓이므로, 백그라운드 에이전트를 여럿 돌리면 열어 본 적도 없는 워크스페이스의
 * 대화가 렌더러에 그대로 만들어진다.
 *
 * **놓아도 잃는 것이 없다.** 항목은 메인이 디스크에 적고 있고(append-only jsonl), 다시
 * 고르는 순간 `loadWorkspaceView` 가 꼬리부터 읽어 온다. 사용자가 잃는 것은 그 한 번의
 * 전환이 조금 느린 것뿐이다 — 세션 정리([[agent/orchestrator]] trimIdleSessions)와 같은 거래다.
 *
 * 시간이 아니라 **개수** 기준인 것도 같은 이유다. 두세 개만 오가는 사용자에게는 아무 일도
 * 일어나지 않고, 실제로 문제가 되는 구간에서만 발동한다.
 */
export const MAX_RESIDENT_TRANSCRIPTS = 8

/**
 * 놓을 트랜스크립트를 고른다. 상한을 넘은 만큼만, 오래 안 쓴 것부터다.
 *
 * 보호 대상(`protectedIds`)은 후보에서 뺀다 — 지금 보고 있는 칸과 아직 도는 워크스페이스가
 * 거기 들어간다. 도는 워크스페이스를 놓으면 아직 디스크에 적히지 않은 스트리밍 중간 상태가
 * 사라져, 화면이 방금 흐르던 문장을 잃는다.
 *
 * 규칙만 떼어 낸 순수 함수다 — 잘못 고르면 사용자가 보던 대화가 사라지므로, 스토어 없이
 * 규칙 자체를 검증할 수 있어야 한다.
 */
export function pickEvictableTranscripts(args: {
  /** 상주 중인 워크스페이스와 마지막으로 쓴 시각. */
  touchedAt: Readonly<Record<string, number>>
  /** 지금 트랜스크립트를 들고 있는 워크스페이스 전부. */
  resident: readonly string[]
  protectedIds: ReadonlySet<string>
  max?: number
}): string[] {
  const max = args.max ?? MAX_RESIDENT_TRANSCRIPTS
  const excess = args.resident.length - max
  if (excess <= 0) return []

  return [...args.resident]
    .filter((id) => !args.protectedIds.has(id))
    .sort((a, b) => (args.touchedAt[a] ?? 0) - (args.touchedAt[b] ?? 0))
    .slice(0, excess)
}
