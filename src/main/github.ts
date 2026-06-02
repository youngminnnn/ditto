import { spawn } from 'node:child_process'
import type { PrStatus } from '@shared/types'

/**
 * 현재 브랜치에 연결된 GitHub PR 상태를 gh CLI 로 조회한다.
 * gh 는 homebrew 경로라 GUI 앱의 빈약한 PATH 에 없으므로 로그인 셸로 실행한다.
 */

interface GhPr {
  number: number
  url: string
  state: string // OPEN | CLOSED | MERGED
  isDraft: boolean
  reviewDecision: string // REVIEW_REQUIRED | CHANGES_REQUESTED | APPROVED | ''
}

function runLoginShell(
  command: string,
  cwd: string
): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh'
    const proc = spawn(shell, ['-lc', command], { cwd })
    let stdout = ''
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    proc.on('error', () => resolve({ stdout, code: 1 }))
    proc.on('close', (code) => resolve({ stdout, code }))
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

export async function getPrStatus(worktreePath: string, branch: string): Promise<PrStatus | null> {
  // worktree 가 이미 제거됐을 수 있으니(아카이브 등) 실패 시 조용히 null.
  const fields = 'number,url,state,isDraft,reviewDecision'
  const { stdout, code } = await runLoginShell(
    `gh pr view ${JSON.stringify(branch)} --json ${fields}`,
    worktreePath
  )
  if (code !== 0) return null
  try {
    const pr = JSON.parse(stdout.trim()) as GhPr
    return { number: pr.number, url: pr.url, label: labelFor(pr) }
  } catch {
    return null
  }
}
