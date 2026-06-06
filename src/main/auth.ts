import { spawn } from 'node:child_process'
import type { AuthStatus, ClaudeAuthStatus, GithubAuthStatus } from '@shared/types'

/**
 * Claude / GitHub CLI 연동 상태를 조회하고 로그인·로그아웃을 트리거한다.
 *
 * 상태 조회는 사용자 로그인 셸(`$SHELL -lc`)로 실행한다 — `claude`(~/.local/bin)·
 * `gh`(homebrew) 가 GUI 로 띄운 앱의 빈약한 PATH 에는 없기 때문이다.
 * 인터랙티브 로그인(OAuth/디바이스 플로우)은 Terminal.app 에서 실행해 흐름이
 * 정상 동작하게 한다(앱 내 가짜 TTY 보다 안정적).
 */

function runLoginShell(
  command: string
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh'
    const proc = spawn(shell, ['-lc', command])
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    proc.on('error', () => resolve({ stdout, stderr, code: 1 }))
    proc.on('close', (code) => resolve({ stdout, stderr, code }))
  })
}

function openInTerminal(command: string): void {
  const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const script = `tell application "Terminal"\nactivate\ndo script "${escaped}"\nend tell`
  spawn('osascript', ['-e', script])
}

/** CLI 가 PATH 에 있는지 확인한다. 미설치와 "설치됐지만 미로그인"을 구분하기 위함이다. */
async function isInstalled(command: 'claude' | 'gh'): Promise<boolean> {
  const { code } = await runLoginShell(`command -v ${command}`)
  return code === 0
}

async function getClaudeStatus(): Promise<ClaudeAuthStatus> {
  if (!(await isInstalled('claude'))) return { installed: false, loggedIn: false }

  const { stdout, code } = await runLoginShell('claude auth status --json')
  if (code !== 0) return { installed: true, loggedIn: false }
  try {
    const json = JSON.parse(stdout.trim()) as Record<string, unknown>
    return {
      installed: true,
      loggedIn: Boolean(json.loggedIn),
      email: json.email as string | undefined,
      orgName: json.orgName as string | undefined,
      subscriptionType: json.subscriptionType as string | undefined,
      authMethod: json.authMethod as string | undefined
    }
  } catch {
    return { installed: true, loggedIn: false }
  }
}

async function getGithubStatus(): Promise<GithubAuthStatus> {
  if (!(await isInstalled('gh'))) return { installed: false, loggedIn: false }

  const { stdout, stderr, code } = await runLoginShell('gh auth status')
  if (code !== 0) return { installed: true, loggedIn: false }
  const out = `${stdout}\n${stderr}`
  const account = out.match(/Logged in to \S+ account (\S+)/)?.[1]
  const protocol = out.match(/Git operations protocol:\s*(\S+)/)?.[1]
  return { installed: true, loggedIn: true, account, protocol }
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const [claude, github] = await Promise.all([getClaudeStatus(), getGithubStatus()])
  return { claude, github }
}

export function claudeLogin(): void {
  openInTerminal('claude auth login')
}

export function claudeLogout(): void {
  spawn(process.env.SHELL || '/bin/zsh', ['-lc', 'claude auth logout'])
}

export function githubLogin(): void {
  openInTerminal('gh auth login')
}

export function githubLogout(): void {
  // gh 로그아웃은 계정 확인 프롬프트가 뜰 수 있어 Terminal 에서 실행한다.
  openInTerminal('gh auth logout')
}
