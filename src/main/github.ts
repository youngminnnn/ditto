import { spawn } from 'node:child_process'
import type { PrCheck, PrCheckState, PrChecks, PrStatus } from '@shared/types'

/**
 * GitHub PR 상태를 gh CLI 로 조회한다.
 *
 * 조회 기준은 workspace worktree 의 "현재 브랜치" 다 — worktree cwd 에서 인자 없이
 * `gh pr view` 를 실행하면 gh 가 현재 브랜치에 연결된 PR 을 찾아준다. 대화 기록에서 URL 을
 * 긁는 방식은 무관한 PR(다른 리포·예전 PR)을 잘못 집을 수 있어 쓰지 않는다.
 * gh 는 homebrew 경로라 GUI 앱 PATH 에 없으므로 로그인 셸로 실행한다.
 */

interface GhPr {
  number: number
  url: string
  title: string
  state: string // OPEN | CLOSED | MERGED
  isDraft: boolean
  reviewDecision: string // REVIEW_REQUIRED | CHANGES_REQUESTED | APPROVED | ''
}

function runLoginShell(
  command: string,
  cwd?: string
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh'
    // gh 는 GITHUB_TOKEN/GH_TOKEN 이 있으면 keyring 로그인보다 우선해 그 토큰을 쓴다.
    // 앱이 dev 터미널·에이전트 환경에서 떠 이 변수를 물려받으면, SSO 미인증 토큰이
    // 정상 로그인 자격증명을 가려 모든 gh 조회가 조직 SAML 에러로 실패한다 → PR 이
    // 있어도 못 찾고 "Create PR" 이 계속 뜬다. 이 변수만 비워 gh 가 본래 자격증명
    // 체인(keyring 등)을 쓰게 한다.
    const env = { ...process.env }
    delete env.GITHUB_TOKEN
    delete env.GH_TOKEN
    const proc = spawn(shell, ['-lc', command], { ...(cwd ? { cwd } : {}), env })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    proc.on('error', () => resolve({ stdout, stderr, code: 1 }))
    proc.on('close', (code) => resolve({ stdout, stderr, code }))
  })
}

function labelFor(pr: GhPr): string {
  if (pr.state === 'MERGED') return 'Merged'
  if (pr.state === 'CLOSED') return 'Closed'
  if (pr.isDraft) return 'Draft'
  switch (pr.reviewDecision) {
    case 'REVIEW_REQUIRED':
      return 'Review required'
    case 'CHANGES_REQUESTED':
      return 'Changes requested'
    case 'APPROVED':
      return 'Ready to merge'
    default:
      return 'Open'
  }
}

/** worktree 의 현재 브랜치에 연결된 PR 상태를 조회한다(인자 없는 `gh pr view`). */
export async function getPrStatus(worktreePath: string): Promise<PrStatus | null> {
  const { stdout, code } = await runLoginShell(
    `gh pr view --json number,url,title,state,isDraft,reviewDecision`,
    worktreePath
  )
  if (code !== 0) return null
  try {
    const pr = JSON.parse(stdout.trim()) as GhPr
    return { number: pr.number, url: pr.url, title: pr.title ?? '', label: labelFor(pr) }
  } catch {
    return null
  }
}

// ── PR/CI 체크 (Check 탭) ──────────────────────────────────────────────────

/** GitHub statusCheckRollup 항목. CheckRun(워크플로) 과 StatusContext(레거시 status) 두 모양이 섞여 온다. */
interface RollupItem {
  __typename?: string
  // CheckRun
  name?: string
  status?: string // QUEUED | IN_PROGRESS | COMPLETED | WAITING | PENDING | REQUESTED
  conclusion?: string // SUCCESS | FAILURE | NEUTRAL | CANCELLED | SKIPPED | TIMED_OUT | ...
  detailsUrl?: string
  workflowName?: string
  // StatusContext
  context?: string
  state?: string // SUCCESS | FAILURE | ERROR | PENDING | EXPECTED
  targetUrl?: string
}

function mapCheckRun(item: RollupItem): PrCheckState {
  if (item.status && item.status !== 'COMPLETED') return 'pending'
  switch (item.conclusion) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'TIMED_OUT':
    case 'STARTUP_FAILURE':
    case 'ACTION_REQUIRED':
      return 'failure'
    case 'SKIPPED':
      return 'skipped'
    default:
      return 'neutral'
  }
}

function mapStatusContext(state: string | undefined): PrCheckState {
  switch (state) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'ERROR':
      return 'failure'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return 'neutral'
  }
}

function toCheck(item: RollupItem): PrCheck | null {
  if (item.__typename === 'StatusContext') {
    if (!item.context) return null
    return { name: item.context, state: mapStatusContext(item.state), url: item.targetUrl || undefined }
  }
  // CheckRun (기본). name 앞에 워크플로명을 붙여 동명 잡(job)을 구분한다.
  if (!item.name) return null
  const label = item.workflowName ? `${item.workflowName} / ${item.name}` : item.name
  return { name: label, state: mapCheckRun(item), url: item.detailsUrl || undefined }
}

/**
 * worktree 의 현재 브랜치에 연결된 PR 의 CI 체크 롤업을 조회한다.
 * `gh pr view --json statusCheckRollup` 한 번으로 PR 번호·URL·체크 목록을 함께 받는다.
 */
export async function getPrChecks(worktreePath: string): Promise<PrChecks | null> {
  const { stdout, code } = await runLoginShell(
    `gh pr view --json number,url,statusCheckRollup`,
    worktreePath
  )
  if (code !== 0) return null
  try {
    const pr = JSON.parse(stdout.trim()) as {
      number: number
      url: string
      statusCheckRollup?: RollupItem[]
    }
    const checks = (pr.statusCheckRollup ?? [])
      .map(toCheck)
      .filter((c): c is PrCheck => c !== null)
    return { prNumber: pr.number, prUrl: pr.url, checks }
  } catch {
    return null
  }
}

/**
 * GitHub PR 작성 화면을 브라우저로 연다(`gh pr create --web --fill`).
 * 실제 생성은 사용자가 브라우저에서 확정하므로 앱이 PR 을 바로 만들지 않는다.
 * 현재 브랜치가 리모트에 push 돼 있지 않거나 커밋이 없으면 gh 가 에러를 내며,
 * 그 메시지를 그대로 돌려준다.
 */
export async function createPrWeb(worktreePath: string): Promise<{ error?: string }> {
  const { stderr, code } = await runLoginShell('gh pr create --web --fill', worktreePath)
  if (code !== 0) {
    const msg = stderr.trim().split('\n').filter(Boolean).pop()
    return { error: msg || 'Failed to open the PR creation page.' }
  }
  return {}
}
