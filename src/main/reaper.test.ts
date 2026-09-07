import { describe, expect, it, vi } from 'vitest'

vi.mock('./logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {} }
}))

const { descendantsOf, parsePsOutput } = await import('./reaper')

/**
 * 여기서 확인하는 것은 [[main/reaper]] 가 답해야 하는 질문 하나다 —
 * **"우리가 죽여야 할 pid 는 정확히 어느 것인가."**
 *
 * 실제 시그널 전송은 테스트하지 않는다. 판정이 틀리면 남의 프로세스를 죽이거나
 * (더 흔하게) 고아를 그대로 남기는데, 그 판정은 전부 이 두 순수 함수 안에 있다.
 */

const BUNDLE = '/Applications/Wooi.app'
const HELPERS = `${BUNDLE}/Contents/Frameworks/`

/** 실제 `ps -axww -o pid=,ppid=,args=` 출력의 모양을 그대로 흉내 낸다. */
function ps(...lines: string[]): string {
  return lines.join('\n') + '\n'
}

describe('parsePsOutput', () => {
  it('reads pid, ppid and the full command', () => {
    const rows = parsePsOutput(ps('  100     1 /sbin/launchd'))
    expect(rows).toEqual([{ pid: 100, ppid: 1, command: '/sbin/launchd' }])
  })

  it('keeps spaces in the command — bundle paths are full of them', () => {
    const line = `  200   100 ${BUNDLE}/Contents/Frameworks/Wooi Helper.app/Contents/MacOS/Wooi Helper --type=gpu-process`
    expect(parsePsOutput(ps(line))[0].command).toBe(
      `${BUNDLE}/Contents/Frameworks/Wooi Helper.app/Contents/MacOS/Wooi Helper --type=gpu-process`
    )
  })

  it('skips the trailing blank line and any header-like junk', () => {
    expect(parsePsOutput(ps('  100     1 /sbin/launchd', '', 'PID PPID COMMAND'))).toHaveLength(1)
  })
})

describe('descendantsOf', () => {
  it('collects the whole tree, not just direct children', () => {
    const rows = parsePsOutput(
      ps('  10     1 /sbin/launchd', '  20    10 /bin/zsh', '  30    20 /usr/bin/node server.js')
    )
    expect(descendantsOf(rows, 10, HELPERS).sort()).toEqual([20, 30])
  })

  it('leaves everything that is not ours alone', () => {
    const rows = parsePsOutput(ps('  10     1 /bin/zsh', '  99     1 /usr/bin/unrelated'))
    expect(descendantsOf(rows, 10, HELPERS)).toEqual([])
  })

  it('spares Electron helpers but kills the bundled CLI underneath them', () => {
    // 이게 이 파일의 핵심 사례다. 헬퍼는 Electron 이 스스로 내리므로 건드리면 안 되지만,
    // 그 헬퍼가 띄운 claude CLI 와 그 CLI 가 띄운 에뮬레이터는 아무도 안 죽인다.
    // 제외를 번들 전체로 넓히면 CLI 가 asar.unpacked 에 있어 같이 살아남는다 — 그래서 안 된다.
    const rows = parsePsOutput(
      ps(
        `  10     1 ${BUNDLE}/Contents/MacOS/Wooi`,
        `  20    10 ${BUNDLE}/Contents/Frameworks/Wooi Helper.app/Contents/MacOS/Wooi Helper --type=utility`,
        `  30    20 ${BUNDLE}/Contents/Resources/app.asar.unpacked/node_modules/claude --output-format json`,
        '  40    30 /opt/homebrew/share/android-commandlinetools/emulator/qemu-system-aarch64 -avd wooi-store'
      )
    )
    const doomed = descendantsOf(rows, 10, HELPERS)
    expect(doomed).not.toContain(20)
    expect(doomed).toContain(30)
    expect(doomed).toContain(40)
  })

  it('spares the Squirrel updater helper — it is waiting for us to go away', () => {
    const rows = parsePsOutput(
      ps(
        `  10     1 ${BUNDLE}/Contents/MacOS/Wooi`,
        '  20    10 /Users/me/Library/Caches/wooi.ShipIt/ShipIt com.wooi.app'
      )
    )
    expect(descendantsOf(rows, 10, HELPERS)).toEqual([])
  })

  it('kills leaves before their parents', () => {
    const rows = parsePsOutput(
      ps('  10     1 /bin/zsh', '  20    10 /bin/zsh', '  30    20 /bin/zsh')
    )
    const doomed = descendantsOf(rows, 10, HELPERS)
    expect(doomed.indexOf(30)).toBeLessThan(doomed.indexOf(20))
  })

  it('never kills the root itself', () => {
    const rows = parsePsOutput(ps('  10    10 /bin/zsh'))
    expect(descendantsOf(rows, 10, HELPERS)).toEqual([])
  })

  it('terminates on a cycle instead of looping forever', () => {
    const rows = parsePsOutput(ps('  20    10 /bin/zsh', '  10    20 /bin/zsh'))
    expect(descendantsOf(rows, 10, HELPERS)).toEqual([20])
  })

  it('excludes no helper when the prefix is unknown', () => {
    const rows = parsePsOutput(ps(`  20    10 ${BUNDLE}/Contents/Frameworks/Wooi Helper`))
    expect(descendantsOf(rows, 10, '')).toEqual([20])
  })
})
