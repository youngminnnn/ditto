import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { log } from './logger'

/**
 * GUI(Finder/dmg)로 띄운 앱은 빈약한 PATH 만 물려받는다 — ~/.local/bin(claude 네이티브
 * 설치)·homebrew(gh) 등이 빠진다. 게다가 zsh 의 로그인 비인터랙티브 셸(-lc)은 .zshrc 를
 * 소스하지 않으므로, PATH 설정이 .zshrc 에 있으면 CLI 가 "설치됐는데 미설치"로 보인다.
 *
 * 앱 시작 시 사용자의 로그인+인터랙티브 셸(-ilc)에서 실제 PATH 를 한 번 캡처해
 * process.env.PATH 에 반영한다. 이후 모든 child spawn(인증 탐지·Agent SDK·gh CLI·스크립트)이
 * 올바른 PATH 를 물려받는다. 캡처 실패에 대비해 흔한 설치 위치도 함께 덧붙인다.
 */
export function hydratePathFromLoginShell(): void {
  const fallbacks = [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
  const current = process.env.PATH ? process.env.PATH.split(':') : []
  const captured = resolveShellPath()

  // 캡처된 PATH 를 앞에, 기존 + 알려진 설치 위치를 뒤에 두고 순서 보존 중복 제거.
  const merged: string[] = []
  const seen = new Set<string>()
  for (const dir of [...(captured ?? []), ...current, ...fallbacks]) {
    if (dir && !seen.has(dir)) {
      seen.add(dir)
      merged.push(dir)
    }
  }

  process.env.PATH = merged.join(':')
  log.info(`env: PATH hydrated (${captured ? 'from login shell' : 'fallbacks only'}, ${merged.length} entries)`)
}

/** 로그인+인터랙티브 셸에서 PATH 를 캡처한다. 실패 시 null. */
function resolveShellPath(): string[] | null {
  const shell = process.env.SHELL || '/bin/zsh'
  const sentinel = '__DITTO_PATH__'
  try {
    // 인터랙티브(-i)여야 .zshrc 가 소스돼 그 안의 PATH 설정이 반영된다. rc 출력 잡음을
    // 피하려고 sentinel 뒤의 값만 취하고(stdout 앞부분 무시), stderr 는 버린다.
    const out = execFileSync(shell, ['-ilc', `printf '%s%s' '${sentinel}' "$PATH"`], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const idx = out.lastIndexOf(sentinel)
    if (idx < 0) return null
    const value = out.slice(idx + sentinel.length).trim()
    return value ? value.split(':') : null
  } catch (err) {
    log.warn('env: failed to resolve login shell PATH', err)
    return null
  }
}
