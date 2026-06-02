import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, join } from 'node:path'
import type { GitStatus } from '@shared/types'

const exec = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 1024 * 1024 * 32 })
  return stdout.trim()
}

/** 경로가 git 워킹트리인지 확인. */
export async function isGitRepo(path: string): Promise<boolean> {
  try {
    const out = await git(path, ['rev-parse', '--is-inside-work-tree'])
    return out === 'true'
  } catch {
    return false
  }
}

/** 리포의 기본 브랜치를 best-effort 로 감지한다 (origin/HEAD → main → master → 현재 브랜치). */
export async function detectDefaultBranch(repoPath: string): Promise<string> {
  try {
    const ref = await git(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    if (ref) return ref.replace(/^origin\//, '')
  } catch {
    // origin/HEAD 미설정 — 관용 이름으로 폴백.
  }
  for (const name of ['main', 'master']) {
    try {
      await git(repoPath, ['rev-parse', '--verify', '--quiet', name])
      return name
    } catch {
      // 해당 브랜치 없음.
    }
  }
  return git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

/** 로컬 브랜치 목록 (기본 브랜치를 맨 앞에 둔다). */
export async function listBranches(repoPath: string): Promise<string[]> {
  const out = await git(repoPath, ['branch', '--format=%(refname:short)'])
  const branches = out.split('\n').map((b) => b.trim()).filter(Boolean)
  const def = await detectDefaultBranch(repoPath)
  return [def, ...branches.filter((b) => b !== def)]
}

/** 브랜치/디렉토리 이름으로 안전한 슬러그를 만든다. */
export function sanitizeBranch(name: string): string {
  const slug = name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._/-]/g, '')
    .replace(/^[-/]+/, '')
    .replace(/\/{2,}/g, '/')
  return slug || 'workspace'
}

/**
 * worktree 경로를 앱 데이터 디렉토리 하위 `worktrees/<repo_name>/<branch>` 에 둔다(Conductor 와 동일).
 * 사용자 리포 부모 디렉토리를 어지럽히지 않도록 앱이 관리하는 위치에 모은다.
 */
export function worktreePathFor(repoPath: string, branch: string): string {
  const repoName = basename(repoPath)
  const slug = sanitizeBranch(branch).replace(/\//g, '-')
  return join(app.getPath('userData'), 'worktrees', repoName, slug)
}

/** 새 브랜치로 worktree 를 추가한다. 브랜치가 이미 있으면 그 브랜치를 체크아웃한다. */
export async function addWorktree(
  repoPath: string,
  branch: string,
  baseBranch: string,
  worktreePath: string
): Promise<void> {
  const branchExists = await git(repoPath, ['rev-parse', '--verify', '--quiet', branch])
    .then(() => true)
    .catch(() => false)

  if (branchExists) {
    await git(repoPath, ['worktree', 'add', worktreePath, branch])
  } else {
    await git(repoPath, ['worktree', 'add', '-b', branch, worktreePath, baseBranch])
  }
}

/** worktree 를 제거하고, 요청 시 브랜치도 삭제한다. */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
  deleteBranch: boolean
): Promise<void> {
  await git(repoPath, ['worktree', 'remove', '--force', worktreePath]).catch(async () => {
    // worktree 디렉토리가 이미 사라졌으면 등록 정보만 정리.
    await git(repoPath, ['worktree', 'prune']).catch(() => {})
  })
  if (deleteBranch) {
    await git(repoPath, ['branch', '-D', branch]).catch(() => {})
  }
}

/** 사이드바 배지용 경량 상태 (브랜치, base 대비 ahead/behind, 변경 파일 수). */
export async function getStatus(worktreePath: string, baseBranch: string): Promise<GitStatus> {
  const branch = await git(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '?')

  let changedFiles = 0
  try {
    const porcelain = await git(worktreePath, ['status', '--porcelain'])
    changedFiles = porcelain ? porcelain.split('\n').filter(Boolean).length : 0
  } catch {
    // 무시 — 0 으로 둔다.
  }

  let ahead = 0
  let behind = 0
  try {
    const counts = await git(worktreePath, [
      'rev-list',
      '--left-right',
      '--count',
      `${baseBranch}...HEAD`
    ])
    const [b, a] = counts.split(/\s+/).map((n) => parseInt(n, 10))
    behind = Number.isFinite(b) ? b : 0
    ahead = Number.isFinite(a) ? a : 0
  } catch {
    // base 브랜치 ref 가 없으면 0 으로 둔다.
  }

  return { branch, ahead, behind, changedFiles }
}

export function repoNameFromPath(path: string): string {
  return basename(path)
}
