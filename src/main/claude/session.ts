import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Query, SDKMessage, SDKUserMessage, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { AsyncQueue } from './asyncQueue'
import { resolveClaudeExecutable } from './executable'
import type {
  ChatItem,
  ChatEvent,
  PermissionMode,
  PermissionRequest,
  PermissionDecision
} from '@shared/types'

export interface SessionDeps {
  cwd: string
  model: string | null
  permissionMode: PermissionMode
  /** 이전 실행에서 이어갈 Claude 세션 ID. 없으면 새 세션. */
  resumeSessionId: string | null
  emit: (event: ChatEvent) => void
  persist: (item: ChatItem) => void
  requestPermission: (
    req: Omit<PermissionRequest, 'requestId' | 'workspaceId'>
  ) => Promise<PermissionDecision>
  onSessionId: (id: string) => void
}

type Block = { type: string; [k: string]: unknown }

// 패키징 빌드에서 SDK 가 app.asar 안 경로로 CLI 를 spawn 해 ENOTDIR 로 실패하지 않도록,
// app.asar.unpacked 의 실제 바이너리 경로를 1회 계산해 둔다(dev 에서는 null → SDK 기본값).
const claudeExecutable = resolveClaudeExecutable()

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
 * 참고: 앱 재시작 간 세션 resume 은 v1 범위 밖이다. UI 기록은 영속화되지만
 * 에이전트 맥락은 실행마다 새로 시작한다(replay 중복 렌더링을 피하기 위한 결정).
 */
export class ClaudeSession {
  private input = new AsyncQueue<SDKUserMessage>()
  private q: Query | null = null
  private currentApiMsgId: string | null = null
  /** 사용자가 "always allow" 한 도구 이름. 이 세션 동안 다시 묻지 않는다. */
  private alwaysAllow = new Set<string>()

  constructor(private deps: SessionDeps) {}

  /** 사용자 메시지를 보낸다. 첫 메시지면 query 를 시작한다. */
  send(text: string): void {
    const item: ChatItem = {
      id: `user:${Date.now()}:${Math.round(performance.now())}`,
      type: 'user',
      text,
      ts: Date.now()
    }
    this.deps.persist(item)
    this.deps.emit({ type: 'item', item })
    this.deps.emit({ type: 'status', status: 'running' })

    this.input.push({
      type: 'user',
      message: { role: 'user', content: text },
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
    try {
      this.q = query({
        prompt: this.input,
        options: {
          cwd: this.deps.cwd,
          includePartialMessages: true,
          permissionMode: this.deps.permissionMode,
          ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
          ...(this.deps.model ? { model: this.deps.model } : {}),
          // 이전 세션 ID 가 있으면 디스크에서 대화 맥락을 복원한다(과거 메시지는 재방출되지 않음).
          ...(this.deps.resumeSessionId ? { resume: this.deps.resumeSessionId } : {}),
          canUseTool: this.canUseTool
        }
      })

      for await (const msg of this.q) {
        this.handleMessage(msg)
      }
    } catch (err) {
      this.emitItem({
        id: `error:${Date.now()}`,
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
        ts: Date.now()
      })
      this.deps.emit({ type: 'status', status: 'error' })
    } finally {
      this.q = null
    }
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
        this.deps.emit({ type: 'delta', id: `${apiId}:text`, itemType: 'assistant', text: event.delta.text })
      } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
        this.deps.emit({ type: 'delta', id: `${apiId}:thinking`, itemType: 'thinking', text: event.delta.thinking })
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
          text: String(block.text ?? ''),
          ts: Date.now(),
          streaming: false
        })
      } else if (block.type === 'thinking') {
        this.emitItem({
          id: `${apiId}:thinking`,
          type: 'thinking',
          text: String(block.thinking ?? ''),
          ts: Date.now(),
          streaming: false
        })
      } else if (block.type === 'tool_use') {
        this.emitItem({
          id: `${apiId}:tool:${String(block.id)}`,
          type: 'tool_use',
          toolId: String(block.id),
          name: String(block.name),
          input: block.input ?? {},
          ts: Date.now()
        })
      }
    }

    if (msg.error) {
      this.emitItem({
        id: `error:${apiId}`,
        type: 'error',
        text: `Assistant error: ${msg.error}`,
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
          text: normalizeToolResult(block.content),
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
    this.deps.emit({ type: 'status', status: 'idle' })
  }

  /** 항목을 영속화하고 renderer 로 보낸다. */
  private emitItem(item: ChatItem): void {
    this.deps.persist(item)
    this.deps.emit({ type: 'item', item })
  }
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
