import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { AsyncQueue } from './asyncQueue'
import { resolveClaudeExecutable } from './executable'
import type { SlashCommandInfo } from '@shared/types'

/**
 * worktree(cwd) 별 슬래시 명령/스킬 목록을 조회해 캐시한다(입력창 자동완성용).
 *
 * 명령 목록은 query 가 떠 있어야 얻을 수 있으므로(Query.supportedCommands),
 * 입력 큐를 비운 채 짧은 수명 query 를 하나 열어 목록만 받고 곧장 닫는다 — 사용자 메시지를
 * 넣지 않으므로 에이전트가 무언가 실행하지 않는다. cwd 마다 1회만 조회하고 결과를 캐시해
 * 자동완성을 빠르게 띄운다(프로젝트 스코프 명령/스킬은 cwd 에 따라 다를 수 있다).
 */
const cache = new Map<string, Promise<SlashCommandInfo[]>>()

export function listSlashCommands(cwd: string): Promise<SlashCommandInfo[]> {
  const cached = cache.get(cwd)
  if (cached) return cached

  const promise = fetchCommands(cwd).catch(() => [] as SlashCommandInfo[])
  cache.set(cwd, promise)
  // 빈 결과(미설치/로그아웃/실패)는 다음 호출에서 다시 시도하도록 캐시에서 비운다.
  void promise.then((cmds) => {
    if (cmds.length === 0) cache.delete(cwd)
  })
  return promise
}

/** CLI 기동/응답이 지연돼도 자동완성이 멈추지 않도록 둔 상한. */
const FETCH_TIMEOUT_MS = 8000

async function fetchCommands(cwd: string): Promise<SlashCommandInfo[]> {
  const input = new AsyncQueue<SDKUserMessage>()
  // session.ts 와 동일 — 패키징 빌드에서 app.asar 내부 경로로 CLI 를 spawn 해 ENOTDIR 로
  // 실패하면 명령 목록이 빈 채로 와 자동완성이 안 뜨므로, unpacked 바이너리 경로를 명시한다.
  const claudeExecutable = resolveClaudeExecutable()
  const q = query({
    prompt: input,
    options: { cwd, ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {}) }
  })
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('supportedCommands timed out')), FETCH_TIMEOUT_MS)
    )
    const commands = await Promise.race([q.supportedCommands(), timeout])
    return commands.map((c) => ({
      name: c.name,
      description: c.description ?? '',
      argumentHint: c.argumentHint || undefined
    }))
  } finally {
    // 정리는 fire-and-forget — 조회 결과 반환을 인터럽트 응답 대기로 막지 않는다.
    input.close()
    void q.interrupt().catch(() => {})
  }
}
