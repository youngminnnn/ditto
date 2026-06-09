import { spawn } from 'node:child_process'
import type { AuthStatus, ClaudeAuthStatus, GithubAuthStatus } from '@shared/types'
import { log } from './logger'

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
    proc.on('error', (err) => {
      log.error(`auth: failed to spawn login shell (${shell})`, err)
      resolve({ stdout, stderr, code: 1 })
    })
    proc.on('close', (code) => resolve({ stdout, stderr, code }))
  })
}

function openInTerminal(command: string): void {
  const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const script = `tell application "Terminal"\nactivate\ndo script "${escaped}"\nend tell`
  spawn('osascript', ['-e', script])
}

// 미탐지 진단을 명령당 1회만 남기기 위한 가드(인증 폴링이 짧은 주기로 반복 호출하므로).
const diagnosed = new Set<string>()

/** CLI 가 PATH 에 있는지 확인한다. 미설치와 "설치됐지만 미로그인"을 구분하기 위함이다. */
async function isInstalled(command: 'claude' | 'gh'): Promise<boolean> {
  const { code } = await runLoginShell(`command -v ${command}`)

  // 미탐지 시 진단 정보를 1회 기록한다 — GUI 로 띄운 앱의 PATH 에 CLI 가 안 잡혀
  // "설치됐는데 미설치로 보이는" 흔한 사례를 로그로 가려내기 위함이다.
  if (code !== 0 && !diagnosed.has(command)) {
    diagnosed.add(command)
    const shell = process.env.SHELL || '/bin/zsh'
    const { stdout: path } = await runLoginShell('echo "$PATH"')
    log.warn(`auth: ${command} not found via ${shell} -lc; PATH=${path.trim()}`)
  }

  return code === 0
}

/**
 * 에이전트(Agent SDK)는 process.env 를 그대로 물려받으므로, 여기에 ANTHROPIC_API_KEY/
 * ANTHROPIC_AUTH_TOKEN 이 있으면 계정 로그인과 무관하게 그 키로 인증·과금한다. main 의
 * process.env 는 시작 시 로그인 셸에서 하이드레이트되므로(env.ts), 사용자의 셸 설정에 키가
 * export 돼 있으면 여기서 그대로 감지된다.
 */
function apiKeyInEnv(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim())
}

async function getClaudeStatus(): Promise<ClaudeAuthStatus> {
  if (!(await isInstalled('claude'))) return { installed: false, loggedIn: false }

  const { stdout, code } = await runLoginShell('claude auth status --json')
  if (code !== 0) return { installed: true, loggedIn: false, apiKeyInEnv: apiKeyInEnv() }
  try {
    const json = JSON.parse(stdout.trim()) as Record<string, unknown>
    return {
      installed: true,
      loggedIn: Boolean(json.loggedIn),
      email: json.email as string | undefined,
      orgName: json.orgName as string | undefined,
      subscriptionType: json.subscriptionType as string | undefined,
      authMethod: json.authMethod as string | undefined,
      apiKeyInEnv: apiKeyInEnv()
    }
  } catch {
    return { installed: true, loggedIn: false, apiKeyInEnv: apiKeyInEnv() }
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
