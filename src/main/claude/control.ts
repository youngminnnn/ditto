import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { AsyncQueue } from './asyncQueue'
import { resolveClaudeExecutable } from './executable'
import { MCP_SETTING_SOURCES, resolveUserMcpServers } from './mcp'
import { clearCommandsCache } from './commands'
import type {
  CommandPanelKind,
  CommandResult,
  ContextUsageInfo,
  McpServerInfo,
  UsageInfo
} from '@shared/types'

/**
 * 인터랙티브(TUI 전용) 슬래시 명령을 Agent SDK 제어 메서드로 실행한다.
 *
 * /mcp·/context·/reload-plugins 같은 명령은 CLI TUI 에서 React 패널을 띄우는 local-jsx 타입이라
 * 일반 프롬프트로 보내면 동작하지 않는다. 대신 Query 객체의 제어 메서드(mcpServerStatus·
 * getContextUsage·reloadPlugins 등)를 호출해 데이터를 받아 카드로 보여 준다.
 *
 * 라이브 세션 쿼리가 있으면 그 위에서 실행한다(컨텍스트 사용량·플러그인 리로드가 "지금 돌고 있는"
 * 에이전트에 반영되도록). 없으면 자동완성 조회(commands.ts)와 같은 방식으로 단명 쿼리를 하나 열어
 * 데이터만 받고 닫는다.
 */

/** 제어 응답이 지연돼도 카드가 멈추지 않도록 둔 상한(자동완성 조회와 동일 성격). */
const CONTROL_TIMEOUT_MS = 15000

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out`)), CONTROL_TIMEOUT_MS)
  )
  return Promise.race([p, timeout])
}

/** 주어진 라이브 Query 위에서 인터랙티브 명령을 실행하고 표시용 결과로 변환한다. */
export async function runCommandOn(kind: CommandPanelKind, q: Query): Promise<CommandResult> {
  switch (kind) {
    case 'mcp': {
      const servers = await withTimeout(q.mcpServerStatus(), 'mcpServerStatus')
      return { kind, servers: servers.map(mapServer) }
    }
    case 'agents': {
      const agents = await withTimeout(q.supportedAgents(), 'supportedAgents')
      return {
        kind,
        agents: agents.map((a) => ({ name: a.name, description: a.description, model: a.model }))
      }
    }
    case 'context': {
      const ctx = await withTimeout(q.getContextUsage(), 'getContextUsage')
      return { kind, context: mapContext(ctx) }
    }
    case 'usage': {
      const usage = await withTimeout(
        q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(),
        'usage'
      )
      return { kind, usage: mapUsage(usage) }
    }
    case 'reloadPlugins': {
      const r = await withTimeout(q.reloadPlugins(), 'reloadPlugins')
      // 리로드로 명령/스킬 집합이 바뀌므로 자동완성 캐시를 비워 다음 입력에서 새로 받게 한다.
      return {
        kind,
        reload: {
          pluginCount: r.plugins.length,
          commandCount: r.commands.length,
          agentCount: r.agents.length,
          mcpServerCount: r.mcpServers.length,
          errorCount: r.error_count
        }
      }
    }
    case 'reloadSkills': {
      const r = await withTimeout(q.reloadSkills(), 'reloadSkills')
      return { kind, reload: { skillCount: r.skills.length } }
    }
  }
}

/**
 * 라이브 쿼리가 없을 때 쓰는 단명 제어 쿼리. 사용자 메시지를 넣지 않으므로 에이전트 턴이 돌지 않고,
 * 세션 옵션(mcpServers 주입·settingSources·실행 파일 경로)은 session.ts 와 동일하게 맞춘다.
 */
export async function runCommandShortLived(
  kind: CommandPanelKind,
  cwd: string,
  repoPath: string | null
): Promise<CommandResult> {
  const input = new AsyncQueue<SDKUserMessage>()
  const claudeExecutable = resolveClaudeExecutable()
  const mcpServers = resolveUserMcpServers(repoPath)
  const q = query({
    prompt: input,
    options: {
      cwd,
      settingSources: MCP_SETTING_SOURCES,
      ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
      ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {})
    }
  })
  try {
    return await runCommandOn(kind, q)
  } finally {
    input.close()
    void q.interrupt().catch(() => {})
  }
}

/** 리로드 결과 처리 후 자동완성 캐시를 무효화해 새 명령 목록이 반영되게 한다. */
export function invalidateAfterReload(kind: CommandPanelKind, cwd: string): void {
  if (kind === 'reloadPlugins' || kind === 'reloadSkills') clearCommandsCache(cwd)
}

// ── 매퍼: SDK 응답 → 표시용 경량 타입 ───────────────────────────────────────

type SdkServer = Awaited<ReturnType<Query['mcpServerStatus']>>[number]
type SdkContext = Awaited<ReturnType<Query['getContextUsage']>>
type SdkUsage = Awaited<ReturnType<Query['usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET']>>

function mapServer(s: SdkServer): McpServerInfo {
  return {
    name: s.name,
    status: s.status,
    scope: s.scope,
    toolCount: s.tools?.length,
    error: s.error,
    version: s.serverInfo?.version
  }
}

function mapContext(c: SdkContext): ContextUsageInfo {
  const categories = c.categories
    .filter((cat) => cat.tokens > 0)
    .map((cat) => ({ name: cat.name, tokens: cat.tokens }))
    .sort((a, b) => b.tokens - a.tokens)
  return {
    totalTokens: c.totalTokens,
    maxTokens: c.maxTokens,
    percentage: c.percentage,
    model: c.model,
    categories
  }
}

function mapUsage(u: SdkUsage): UsageInfo {
  const limits: UsageInfo['rateLimits'] = []
  const rl = u.rate_limits
  if (rl) {
    const push = (label: string, w?: { utilization: number | null; resets_at: string | null } | null): void => {
      if (w) limits.push({ label, utilization: w.utilization, resetsAt: w.resets_at })
    }
    push('5-hour', rl.five_hour)
    push('7-day', rl.seven_day)
    push('7-day (Opus)', rl.seven_day_opus)
    push('7-day (Sonnet)', rl.seven_day_sonnet)
  }
  return {
    totalCostUsd: u.session.total_cost_usd,
    linesAdded: u.session.total_lines_added,
    linesRemoved: u.session.total_lines_removed,
    subscriptionType: u.subscription_type,
    rateLimitsAvailable: u.rate_limits_available,
    rateLimits: limits
  }
}
