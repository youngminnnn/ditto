import { query } from '@anthropic-ai/claude-agent-sdk'
import type {
  Query,
  SDKMessage,
  SDKUserMessage,
  PermissionResult
} from '@anthropic-ai/claude-agent-sdk'
import { AsyncQueue } from './asyncQueue'
import { clampText, clampInput } from './clamp'
import { resolveClaudeExecutable } from './executable'
import { MCP_SETTING_SOURCES, resolveUserMcpServers } from './mcp'
import type {
  ChatItem,
  ChatEvent,
  ImageAttachment,
  PermissionMode,
  PermissionRequest,
  PermissionDecision
} from '@shared/types'

export interface SessionDeps {
  cwd: string
  /** worktree 의 원본 repo 절대 경로. ~/.claude.json 의 project 스코프 MCP 조회에 쓴다(없으면 user 스코프만). */
  repoPath: string | null
  model: string | null
  permissionMode: PermissionMode
  /** true 면 컨텍스트 사용률이 임계치를 넘었을 때 턴 종료 후 /compact 를 자동 주입한다. */
  autoCompact: boolean
  /** 이전 실행에서 이어갈 Claude 세션 ID. 없으면 새 세션. */
  resumeSessionId: string | null
  emit: (event: ChatEvent) => void
  persist: (item: ChatItem) => void
  requestPermission: (
    req: Omit<PermissionRequest, 'requestId' | 'workspaceId'>
  ) => Promise<PermissionDecision>
  onSessionId: (id: string) => void
  /**
   * 진행 중이던 턴이 정상 result 없이 끝났을 때(예: CLI 프로세스가 턴 도중 죽어 result 가
   * 영영 오지 않는 경우) workspace 상태를 idle 로 확정한다. emit('status', idle) 와 달리
   * "Response complete" 알림을 띄우지 않도록 manager.forceIdle 로 연결한다.
   */
  settleIdle: () => void
}

type Block = { type: string; [k: string]: unknown }

// 패키징 빌드에서 SDK 가 app.asar 안 경로로 CLI 를 spawn 해 ENOTDIR 로 실패하지 않도록,
// app.asar.unpacked 의 실제 바이너리 경로를 1회 계산해 둔다(dev 에서는 null → SDK 기본값).
const claudeExecutable = resolveClaudeExecutable()

/**
 * 자동 압축을 트리거하는 컨텍스트 사용률(퍼센트). 사용자에게 노출·수정시키지 않는 내부 상수다.
 * Claude Code 가 한계 직전(다음 응답을 더 못 담는 시점, 대략 ~92~95%)에 압축하는 동작에 맞춘 근사값.
 * getContextUsage() 의 percentage(= /context 카드와 같은 기준)와 직접 비교한다.
 */
const AUTO_COMPACT_THRESHOLD = 92

/** getContextUsage 제어 요청 상한. 지연돼도 미터·자동압축 판단이 멈추지 않도록 둔다. */
const CONTEXT_USAGE_TIMEOUT_MS = 5000

/** p 가 ms 안에 끝나지 않으면 reject 한다(타임아웃 시 호출부가 폴백 경로로 빠지도록). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ])
}

/**
 * 하나의 workspace 에 묶인 단일 Claude Code 세션.
 *
 * 사용자가 첫 메시지를 보낼 때 lazy 하게 query 를 시작한다(자동 프롬프트·자동 실행 없음).
 * Agent SDK 의 streaming input 으로 장수명 query 한 개를 유지하며, 사용자 메시지가
 * 올 때마다 입력 큐에 흘려보낸다 — 같은 세션 안에서 멀티턴 맥락이 유지된다.
 *
 * SDK 메시지(stream_event/assistant/user/result)를 renderer 가 그릴 수 있는
 * ChatEvent 로 변환하고, 권위 있는 항목은 트랜스크립트에 영속화한다.
 *
 * 에이전트 맥락 보존: 이전 실행의 세션 ID(resumeSessionId)가 있으면 query 시작 시 resume 로
 * 디스크의 대화 맥락을 이어받는다 — 앱 재시작·모델 변경 후에도 같은 대화를 계속할 수 있다
 * (과거 메시지는 재방출되지 않아 중복 렌더링이 없다). resume 대상 세션이 사라졌거나(예: ~/.claude
 * 정리, 다른 머신) 손상돼 첫 메시지 전에 실패하면, 맥락만 잃고 새 세션으로 1회 폴백해
 * 사용자가 막히지 않게 한다(retryWithoutResume).
 */
export class ClaudeSession {
  private input = new AsyncQueue<SDKUserMessage>()
  private q: Query | null = null
  private currentApiMsgId: string | null = null
  /** 사용자가 "always allow" 한 도구 이름. 이 세션 동안 다시 묻지 않는다. */
  private alwaysAllow = new Set<string>()
  /**
   * 자동 압축 /compact 를 주입해 두고 그 결과(result)를 기다리는 중인지.
   * 압축 턴의 result·boundary 가 다시 임계치를 넘겨 무한 압축 루프를 도는 것을 막는다.
   */
  private autoCompactInFlight = false
  /** 이번 query 에서 SDK 메시지를 하나라도 받았는지(= 세션이 정상 시작됐는지). resume 폴백 판단용. */
  private sawAnyMessage = false
  /** resume 실패로 새 세션 폴백을 이미 1회 시도했는지(무한 재시도 방지). */
  private resumeRetried = false
  /**
   * 턴이 진행 중인지(running 을 방출했고 아직 result/error 로 마무리되지 않았는지).
   * query 루프가 result 없이 끝났을 때 'running' 에 갇히지 않도록 finally 에서 idle 로 푸는 데 쓴다.
   */
  private active = false

  constructor(private deps: SessionDeps) {}

  /**
   * 현재 살아 있는 streaming query(없으면 null). 인터랙티브 명령(/mcp·/context 등)을 "지금 돌고
   * 있는" 세션 위에서 실행하려는 manager 가 참조한다 — 라이브 쿼리가 없으면 단명 쿼리로 폴백한다.
   */
  get liveQuery(): Query | null {
    return this.q
  }

  /**
   * /mcp 서버 동작(재연결·활성/비활성)처럼 살아 있는 제어 채널이 필요한 명령을 위해,
   * 아직 query 가 없으면 사용자 메시지 없이 query 를 시작(warm up)하고 그 핸들을 돌려준다.
   *
   * run() 은 첫 await 이전에 this.q 를 동기적으로 설정하므로, 호출 직후 항상 살아 있는 query 가 있다.
   * 메시지를 보내지 않으므로 에이전트 턴은 돌지 않고(상태도 running 으로 바뀌지 않음) MCP 연결만
   * 맺으며, 여기서 적용한 토글/재연결은 이후 사용자가 같은 세션에서 대화를 이어가도 유지된다.
   */
  ensureLiveQuery(): Query {
    if (!this.q) this.run()
    if (!this.q) throw new Error('Failed to start session query.')
    return this.q
  }

  /** 사용자 메시지를 보낸다. 첫 메시지면 query 를 시작한다. */
  send(text: string, images?: ImageAttachment[]): void {
    const imgs = images ?? []
    const item: ChatItem = {
      id: `user:${Date.now()}:${Math.round(performance.now())}`,
      type: 'user',
      text,
      ts: Date.now(),
      // base64 본문은 트랜스크립트에 남기지 않고(무겁다) 이름/형식만 칩으로 표시.
      ...(imgs.length ? { attachments: imgs.map((i) => ({ name: i.name, mediaType: i.mediaType })) } : {})
    }
    this.deps.persist(item)
    this.deps.emit({ type: 'item', item })
    this.deps.emit({ type: 'status', status: 'running' })
    this.active = true

    // 이미지가 있으면 멀티모달 content 배열로(텍스트 블록 + base64 이미지 블록), 없으면 문자열.
    const content = imgs.length
      ? [
          ...(text ? [{ type: 'text' as const, text }] : []),
          ...imgs.map((i) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: i.mediaType, data: i.dataBase64 }
          }))
        ]
      : text

    this.input.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null
    })

    if (!this.q) this.run()
  }

  async interrupt(): Promise<void> {
    await this.q?.interrupt().catch(() => {})
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.deps.permissionMode = mode
    await this.q?.setPermissionMode(mode).catch(() => {})
  }

  /** 입력 큐를 닫아 query 루프를 정상 종료시킨다. */
  dispose(): void {
    this.input.close()
    this.q?.interrupt().catch(() => {})
  }

  // ── query 루프 ─────────────────────────────────────────────────────────

  private async run(): Promise<void> {
    // resume 실패 시 새 세션으로 폴백할지. finally 이후에 재시도해 this.q 클로버를 피한다.
    let retrying = false
    try {
      // 사용자가 claude CLI 용으로 등록한 MCP 서버(user/project/local 스코프)를 명시 주입한다.
      // cwd 가 worktree 라 SDK 자동 탐색만으로는 원본 repo 의 project 스코프 서버가 누락되기 때문.
      const mcpServers = resolveUserMcpServers(this.deps.repoPath)
      this.q = query({
        prompt: this.input,
        options: {
          cwd: this.deps.cwd,
          includePartialMessages: true,
          permissionMode: this.deps.permissionMode,
          // CLI 와 동일하게 파일시스템 설정(settings.json·CLAUDE.md·.mcp.json)을 로드.
          settingSources: MCP_SETTING_SOURCES,
          ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
          ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
          ...(this.deps.model ? { model: this.deps.model } : {}),
          // 이전 세션 ID 가 있으면 디스크에서 대화 맥락을 복원한다(과거 메시지는 재방출되지 않음).
          ...(this.deps.resumeSessionId ? { resume: this.deps.resumeSessionId } : {}),
          canUseTool: this.canUseTool
        }
      })

      for await (const msg of this.q) {
        this.sawAnyMessage = true
        this.handleMessage(msg)
      }
    } catch (err) {
      // resume 대상 세션이 사라졌거나 손상돼 첫 메시지 전에 실패한 경우, 맥락만 포기하고
      // 새 세션으로 1회 폴백한다 — 보존하려던 맥락 때문에 오히려 워크스페이스가 막히는 것을 막는다.
      if (this.deps.resumeSessionId && !this.sawAnyMessage && !this.resumeRetried) {
        retrying = true
        this.resumeRetried = true
        this.deps.resumeSessionId = null
        this.emitItem({
          id: `system:resume-fallback:${Date.now()}`,
          type: 'system',
          text: "Couldn't restore the previous session context — continuing in a fresh session.",
          ts: Date.now()
        })
      } else {
        this.emitItem({
          id: `error:${Date.now()}`,
          type: 'error',
          text: clampText(err instanceof Error ? err.message : String(err)),
          ts: Date.now()
        })
        this.deps.emit({ type: 'status', status: 'error' })
        this.active = false
      }
    } finally {
      this.q = null
      // 루프가 (예외도, 정상 result 도 없이) 끝났는데 턴이 진행 중으로 남아 있으면 —
      // 예: CLI 프로세스가 턴 도중 죽어 스트림이 result 없이 닫힌 경우 — 'running' 에
      // 갇히므로 idle 로 확정한다. 앱은 살아 있어 부팅 시 store 정규화가 닿지 못하는 케이스다.
      // 단, resume 폴백으로 재시도하는 경우는 턴이 새 세션에서 계속되므로 idle 로 풀지 않는다.
      if (this.active && !retrying) {
        this.active = false
        this.deps.settleIdle()
      }
    }

    // 폴백 재시도는 finally 가 this.q 를 비운 뒤에 시작해, 새 query 핸들이 덮어써지지 않게 한다.
    // input 큐는 그대로라 폴백 세션이 같은(아직 처리되지 않은) 사용자 메시지를 이어 처리한다.
    if (retrying) this.run()
  }

  // ── 권한 콜백 ──────────────────────────────────────────────────────────

  private canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
    options: { title?: string; displayName?: string; decisionReason?: string }
  ): Promise<PermissionResult> => {
    // AskUserQuestion 은 "행위 승인" 대상이 아니라 모델이 사용자에게 답을 요청하는 도구다.
    // permission mode(auto 포함)·세션 always-allow 와 무관하게 항상 질문을 띄우고, 사용자가
    // 고른 답(updatedInput.answers)을 도구 입력에 합쳐 돌려줘야 한다. 자동 승인하면 answers 가
    // 비어 모델이 "사용자가 답하지 않았다" 고 보고 그대로 진행한다.
    if (toolName === 'AskUserQuestion') {
      const decision = await this.deps.requestPermission({
        toolName,
        title: options.title,
        displayName: options.displayName,
        decisionReason: options.decisionReason,
        input
      })

      if (decision.behavior === 'allow') {
        return { behavior: 'allow', updatedInput: decision.updatedInput ?? input }
      }
      return { behavior: 'deny', message: 'User dismissed the question' }
    }

    // auto 모드: 분류기가 대부분 자동 처리하지만, 위험으로 분류돼 ask 경로로 넘어온 호출도
    // 사용자에게 묻지 않고 자동 승인한다(auto = "묻지 마" 라는 사용자 기대에 맞춤).
    if (this.deps.permissionMode === 'auto') {
      return { behavior: 'allow', updatedInput: input }
    }

    // 사용자가 이 세션에서 항상 허용하기로 한 도구는 다시 묻지 않는다.
    if (this.alwaysAllow.has(toolName)) {
      return { behavior: 'allow', updatedInput: input }
    }

    const decision = await this.deps.requestPermission({
      toolName,
      title: options.title,
      displayName: options.displayName,
      decisionReason: options.decisionReason,
      input
    })

    // allow 분기는 런타임 스키마상 updatedInput(record) 이 필수다(.d.ts 에는 optional 로
    // 표기돼 있으나 CLI 브리지의 Zod 검증은 필수). 원래 입력을 그대로 돌려준다.
    if (decision.behavior === 'allow') {
      if (decision.rememberForSession) this.alwaysAllow.add(toolName)
      return { behavior: 'allow', updatedInput: input }
    }
    return { behavior: 'deny', message: 'User denied permission' }
  }

  // ── 메시지 → ChatEvent 변환 ────────────────────────────────────────────

  private handleMessage(msg: SDKMessage): void {
    switch (msg.type) {
      case 'system':
        this.handleSystem(msg)
        break
      case 'stream_event':
        this.handleStreamEvent(msg)
        break
      case 'assistant':
        this.handleAssistant(msg)
        break
      case 'user':
        this.handleUser(msg)
        break
      case 'result':
        this.handleResult(msg)
        break
      default:
        // status / session_state_changed / 기타는 무시.
        break
    }
  }

  private handleSystem(msg: Extract<SDKMessage, { type: 'system' }>): void {
    if (msg.subtype === 'init') {
      this.deps.onSessionId(msg.session_id)
      this.deps.emit({ type: 'session', sessionId: msg.session_id, model: msg.model })
    } else if (msg.subtype === 'permission_denied') {
      this.emitItem({
        id: `denied:${msg.tool_use_id}`,
        type: 'system',
        text: `Permission denied: ${msg.tool_name}`,
        ts: Date.now()
      })
    } else if (msg.subtype === 'status') {
      // CLI 가 압축을 시작하면 status='compacting' 을 보낸다(수동 /compact 포함). UI 배지용.
      if (msg.status === 'compacting') this.deps.emit({ type: 'compacting', active: true })
    } else if (msg.subtype === 'compact_boundary') {
      // 압축 완료 — 토큰 변화를 기록으로 남기고 진행 배지를 내린다. 자동/수동 모두 여기로 온다.
      const meta = msg.compact_metadata
      const pre = meta?.pre_tokens
      const post = meta?.post_tokens
      const delta =
        typeof pre === 'number' && typeof post === 'number'
          ? ` (${formatTokens(pre)} → ${formatTokens(post)} tokens)`
          : ''
      this.emitItem({
        id: `compacted:${msg.uuid}`,
        type: 'system',
        text: `Compacted conversation${delta}.`,
        ts: Date.now()
      })
      this.deps.emit({ type: 'compacting', active: false, trigger: meta?.trigger })
    }
  }

  /** stream_event 는 텍스트/사고 과정의 실시간 타이핑에만 사용한다. */
  private handleStreamEvent(msg: Extract<SDKMessage, { type: 'stream_event' }>): void {
    const event = msg.event as { type: string; message?: { id?: string }; delta?: { type: string; text?: string; thinking?: string } }

    if (event.type === 'message_start') {
      this.currentApiMsgId = event.message?.id ?? `msg:${Date.now()}`
      return
    }

    if (event.type === 'content_block_delta' && event.delta) {
      const apiId = this.currentApiMsgId ?? `msg:${Date.now()}`
      if (event.delta.type === 'text_delta' && event.delta.text) {
        this.deps.emit({ type: 'delta', id: `${apiId}:text`, itemType: 'assistant', text: clampText(event.delta.text) })
      } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
        this.deps.emit({ type: 'delta', id: `${apiId}:thinking`, itemType: 'thinking', text: clampText(event.delta.thinking) })
      }
    }
  }

  /** 권위 있는 assistant 메시지로 각 블록을 확정·영속화한다. */
  private handleAssistant(msg: Extract<SDKMessage, { type: 'assistant' }>): void {
    const m = msg.message as unknown as { id?: string; content?: Block[] }
    const apiId = m.id ?? msg.uuid
    const blocks = m.content ?? []

    for (const block of blocks) {
      if (block.type === 'text') {
        this.emitItem({
          id: `${apiId}:text`,
          type: 'assistant',
          text: clampText(String(block.text ?? '')),
          ts: Date.now(),
          streaming: false
        })
      } else if (block.type === 'thinking') {
        this.emitItem({
          id: `${apiId}:thinking`,
          type: 'thinking',
          text: clampText(String(block.thinking ?? '')),
          ts: Date.now(),
          streaming: false
        })
      } else if (block.type === 'tool_use') {
        this.emitItem({
          id: `${apiId}:tool:${String(block.id)}`,
          type: 'tool_use',
          toolId: String(block.id),
          name: String(block.name),
          input: clampInput(block.input ?? {}),
          ts: Date.now()
        })
      }
    }

    if (msg.error) {
      this.emitItem({
        id: `error:${apiId}`,
        type: 'error',
        text: clampText(`Assistant error: ${msg.error}`),
        ts: Date.now()
      })
    }
  }

  /** user 메시지(여기서는 tool_result 블록)를 항목으로 변환한다. */
  private handleUser(msg: Extract<SDKMessage, { type: 'user' }>): void {
    const content = (msg.message as { content?: unknown }).content
    if (!Array.isArray(content)) return

    for (const block of content as Block[]) {
      if (block.type === 'tool_result') {
        this.emitItem({
          id: `toolresult:${String(block.tool_use_id)}`,
          type: 'tool_result',
          toolId: String(block.tool_use_id),
          text: clampText(normalizeToolResult(block.content)),
          isError: Boolean(block.is_error),
          ts: Date.now()
        })
      }
    }
  }

  private handleResult(msg: Extract<SDKMessage, { type: 'result' }>): void {
    this.deps.onSessionId(msg.session_id)
    this.emitItem({
      id: `result:${msg.uuid}`,
      type: 'result',
      subtype: msg.subtype,
      isError: msg.subtype !== 'success',
      durationMs: msg.duration_ms,
      numTurns: msg.num_turns,
      costUsd: msg.total_cost_usd,
      ts: Date.now()
    })

    // 방금 끝난 게 우리가 주입한 자동 압축 턴이라면, 재평가하지 않고 플래그만 풀어 준다
    // (압축 직후 result 의 토큰은 요약 생성분이라 다시 임계치를 넘길 수 있어 루프가 된다).
    const wasAutoCompact = this.autoCompactInFlight
    if (wasAutoCompact) {
      this.autoCompactInFlight = false
      this.deps.emit({ type: 'compacting', active: false, trigger: 'auto' })
    }

    this.deps.emit({ type: 'status', status: 'idle' })
    this.active = false

    // 컨텍스트 미터를 갱신한다. 압축 턴 직후가 아니면 임계치 초과 시 자동 압축도 트리거한다.
    // (성공 턴에만 사용량이 의미 있다.)
    if (msg.subtype === 'success') {
      void this.refreshContextUsage({ allowAutoCompact: !wasAutoCompact })
    }
  }

  /**
   * 상태줄 컨텍스트 미터를 SDK 의 getContextUsage 로 갱신한다.
   *
   * /context 카드와 **같은 출처**(getContextUsage)를 써서 미터 수치가 /context 와 항상
   * 일치하게 한다. 과거에는 result 의 modelUsage 를 `used / contextWindow`(전체 윈도 대비
   * 평평한 %)로 직접 계산했는데, Claude Code 는 `(윈도 − 출력 버퍼)` 기준 + 보정 로직으로
   * 퍼센트를 내므로 둘이 크게 어긋났다(미터가 /context 보다 한참 낮게 표시).
   *
   * 라이브 쿼리가 없거나 제어 응답이 실패하면 미터는 이전 값을 유지한다.
   */
  private async refreshContextUsage(opts: { allowAutoCompact: boolean }): Promise<void> {
    const q = this.q
    if (!q) return

    let ctx: Awaited<ReturnType<Query['getContextUsage']>>
    try {
      ctx = await withTimeout(q.getContextUsage(), CONTEXT_USAGE_TIMEOUT_MS)
    } catch {
      return
    }

    const max = ctx.maxTokens || 0
    if (max <= 0) return

    // getContextUsage 의 percentage 는 0~100 스케일. 미터/스토어는 0~1 fraction 을 기대한다.
    const fraction = Math.min(1, Math.max(0, ctx.percentage / 100))
    this.deps.emit({
      type: 'context',
      usedTokens: ctx.totalTokens,
      maxTokens: max,
      percentage: fraction
    })

    // 임계치를 넘었으면 다음 턴 전에 자동으로 압축한다(Claude Code CLI 의 auto-compact).
    // /context 와 동일한 점유율(ctx.percentage, 0~100)을 기준으로 판단한다.
    if (opts.allowAutoCompact && this.deps.autoCompact && ctx.percentage >= AUTO_COMPACT_THRESHOLD) {
      this.triggerAutoCompact()
    }
  }

  /** 입력 큐에 /compact 를 흘려보내 대화를 압축한다. idle 상태(턴 종료 직후)에서만 호출한다. */
  private triggerAutoCompact(): void {
    if (this.autoCompactInFlight || !this.q) return
    this.autoCompactInFlight = true

    // 임계치 수치를 드러내지 않도록 퍼센트 없이 일반 문구로 안내한다.
    this.emitItem({
      id: `compacting:${Date.now()}`,
      type: 'system',
      text: 'Auto-compacting conversation to free up space…',
      ts: Date.now()
    })
    this.deps.emit({ type: 'compacting', active: true, trigger: 'auto' })
    this.deps.emit({ type: 'status', status: 'running' })
    this.active = true

    this.input.push({
      type: 'user',
      message: { role: 'user', content: '/compact' },
      parent_tool_use_id: null
    })
  }

  /** 항목을 영속화하고 renderer 로 보낸다. */
  private emitItem(item: ChatItem): void {
    this.deps.persist(item)
    this.deps.emit({ type: 'item', item })
  }
}

/** 토큰 수를 1.2k / 45k / 1.0M 처럼 짧게 표기한다(압축 전후 안내 문구용). */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

/** tool_result 의 content(string | 블록 배열)를 표시용 텍스트로 정규화한다. */
function normalizeToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'string') return b
        if (b && typeof b === 'object' && 'text' in b) return String((b as { text: unknown }).text)
        return JSON.stringify(b)
      })
      .join('\n')
  }
  if (content == null) return ''
  return JSON.stringify(content, null, 2)
}
