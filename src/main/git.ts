import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, join } from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import type { FileDiff, FileDiffStatus, GitStatus, WorkspaceDiff } from '@shared/types'

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

// ── diff (변경 검토용) ───────────────────────────────────────────────────

const UNTRACKED_MAX_BYTES = 512 * 1024

/**
 * base 브랜치 대비 workspace 의 전체 변경을 파일별로 반환한다.
 * 추적 파일은 `git diff <base>`(커밋 + staged + unstaged 를 한 번에 반영)로,
 * 신규(untracked) 파일은 별도로 합쳐 "추가됨" 으로 표시한다.
 */
export async function getDiff(worktreePath: string, baseBranch: string): Promise<WorkspaceDiff> {
  // base 가 분기 이후 전진했어도 base 의 새 커밋이 역방향 변경으로 보이지 않도록,
  // base..HEAD 의 공통 조상(merge-base)을 기준으로 working tree 와 비교한다(PR diff 와 동일 의미).
  const from = await git(worktreePath, ['merge-base', baseBranch, 'HEAD']).catch(() => baseBranch)

  let raw = ''
  try {
    raw = await git(worktreePath, ['diff', from])
  } catch {
    // base ref 가 없으면 추적 변경은 비운다.
  }
  const files = parseUnifiedDiff(raw)

  // untracked(신규) 파일은 git diff 에 나오지 않으므로 직접 추가 패치를 만든다.
  try {
    const out = await git(worktreePath, ['ls-files', '--others', '--exclude-standard'])
    for (const rel of out.split('\n').map((p) => p.trim()).filter(Boolean)) {
      files.push(untrackedFileDiff(join(worktreePath, rel), rel))
    }
  } catch {
    // 무시.
  }

  files.sort((a, b) => a.path.localeCompare(b.path))
  return { baseBranch, files }
}

/** 통합 diff 출력을 파일 단위로 쪼갠다. */
function parseUnifiedDiff(raw: string): FileDiff[] {
  if (!raw.trim()) return []
  // 각 파일 블록은 "diff --git " 으로 시작한다.
  return raw
    .split(/^diff --git /m)
    .filter((c) => c.trim())
    .map((chunk) => {
      const body = `diff --git ${chunk}`.replace(/\n+$/, '\n')
      const lines = body.split('\n')

      const binary = lines.some((l) => l.startsWith('Binary files'))
      let status: FileDiffStatus = 'modified'
      if (lines.some((l) => l.startsWith('new file'))) status = 'added'
      else if (lines.some((l) => l.startsWith('deleted file'))) status = 'deleted'
      else if (lines.some((l) => l.startsWith('rename '))) status = 'renamed'

      const plus = lines.find((l) => l.startsWith('+++ '))?.slice(4)
      const minus = lines.find((l) => l.startsWith('--- '))?.slice(4)
      const renameTo = lines.find((l) => l.startsWith('rename to '))?.slice('rename to '.length)
      const path =
        renameTo ??
        stripGitPrefix(plus && plus !== '/dev/null' ? plus : minus) ??
        firstHeaderPath(lines[0]) ??
        '(unknown)'

      let additions = 0
      let deletions = 0
      for (const l of lines) {
        if (l.startsWith('+') && !l.startsWith('+++')) additions++
        else if (l.startsWith('-') && !l.startsWith('---')) deletions++
      }

      return { path, status, additions, deletions, patch: binary ? '' : body, binary }
    })
}

function stripGitPrefix(p: string | undefined): string | undefined {
  if (!p) return undefined
  return p.replace(/^[ab]\//, '')
}

/** "diff --git a/foo b/foo" 헤더 라인에서 경로를 best-effort 로 추출. */
function firstHeaderPath(header: string | undefined): string | undefined {
  if (!header) return undefined
  const m = header.match(/^diff --git a\/(.+) b\//)
  return m?.[1]
}

/** untracked 신규 파일을 "추가됨" 통합 diff 로 만든다. */
function untrackedFileDiff(absPath: string, rel: string): FileDiff {
  const header = `diff --git a/${rel} b/${rel}\nnew file\n--- /dev/null\n+++ b/${rel}\n`
  try {
    if (statSync(absPath).size > UNTRACKED_MAX_BYTES) {
      return { path: rel, status: 'added', additions: 0, deletions: 0, patch: '', binary: true }
    }
    const buf = readFileSync(absPath)
    if (buf.includes(0)) {
      return { path: rel, status: 'added', additions: 0, deletions: 0, patch: '', binary: true }
    }
    const text = buf.toString('utf-8')
    if (text === '') {
      return { path: rel, status: 'added', additions: 0, deletions: 0, patch: header, binary: false }
    }
    // split('\n') 은 끝 개행 때문에 빈 마지막 항목을 만든다 — 실제 내용 줄만 남긴다.
    const all = text.split('\n')
    const contentLines = text.endsWith('\n') ? all.slice(0, -1) : all
    const n = contentLines.length
    const hunk = `@@ -0,0 +1,${n} @@\n` + contentLines.map((l) => `+${l}`).join('\n')
    return { path: rel, status: 'added', additions: n, deletions: 0, patch: header + hunk, binary: false }
  } catch {
    return { path: rel, status: 'added', additions: 0, deletions: 0, patch: '', binary: true }
  }
}
