import { spawn } from 'node:child_process'
import type { PrStatus } from '@shared/types'

/**
 * GitHub PR 상태를 gh CLI 로 조회한다.
 *
 * workspace 브랜치명이 PR 의 head 브랜치와 다른 경우가 흔하다 — 에이전트가 별도 명명 규칙
 * (PFM-xxxx 등) 으로 새 브랜치를 만들어 PR 을 열기 때문. 그래서 우선 대화 기록에서 에이전트가
 * 남긴 PR URL 을 찾아 그 URL 로 조회하고(브랜치명 무관), 못 찾으면 워크스페이스 브랜치명으로
 * 폴백한다. gh 는 homebrew 경로라 GUI 앱 PATH 에 없으므로 로그인 셸로 실행한다.
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
  cwd?: string
): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh'
    const proc = spawn(shell, ['-lc', command], cwd ? { cwd } : {})
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

/** branch 이름 또는 PR URL 로 상태를 조회한다. */
async function queryPr(arg: string, cwd?: string): Promise<PrStatus | null> {
  const { stdout, code } = await runLoginShell(
    `gh pr view ${JSON.stringify(arg)} --json number,url,state,isDraft,reviewDecision`,
    cwd
  )
  if (code !== 0) return null
  try {
    const pr = JSON.parse(stdout.trim()) as GhPr
    return { number: pr.number, url: pr.url, label: labelFor(pr) }
  } catch {
    return null
  }
}

export function getPrStatusByUrl(url: string): Promise<PrStatus | null> {
  return queryPr(url)
}

export function getPrStatusByBranch(worktreePath: string, branch: string): Promise<PrStatus | null> {
  return queryPr(branch, worktreePath)
}

/** worktree origin 리모트에서 owner/repo 슬러그를 추출한다. */
export async function repoSlug(worktreePath: string): Promise<string | null> {
  const { stdout, code } = await runLoginShell('git remote get-url origin', worktreePath)
  if (code !== 0) return null
  const m = stdout.trim().match(/github\.com[:/]([^/]+\/[^/.\s]+?)(?:\.git)?$/)
  return m ? m[1] : null
}

/** 텍스트에서 마지막 GitHub PR URL 을 찾는다. slug 가 주어지면 해당 리포의 PR 로 한정. */
export function findPrUrl(text: string, slug: string | null): string | null {
  const re = /https:\/\/github\.com\/([^/\s)]+\/[^/\s)]+)\/pull\/(\d+)/g
  let last: string | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (!slug || m[1] === slug) last = `https://github.com/${m[1]}/pull/${m[2]}`
  }
  return last
}
