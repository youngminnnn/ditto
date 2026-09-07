import { execFileSync } from 'node:child_process'
import { log } from './logger'

/**
 * 종료 직전에 우리가 낳은 프로세스 트리 전체를 훑어 남은 것을 죽인다.
 *
 * **왜 추적 목록만으로는 부족한가.** 정상 경로에는 이미 정리자가 다 있다 —
 * [[main/scripts]] 의 disposeAll 은 프로세스 그룹째, [[main/terminal]] 도, codex 의 app-server 도
 * 각자 자기 자식을 안다. 그런데 실제로 배터리를 태운 것은 그 목록 어디에도 없는 **손자**였다:
 * `claude` CLI 가 Bash 도구로 띄운 안드로이드 에뮬레이터가 6일, expo dev 서버가 11일 동안
 * 부모 1(launchd)로 입양된 채 돌고 있었다. 그 CLI 를 띄운 것은 우리지만, 에뮬레이터를 띄운
 * 것은 우리가 아니므로 어느 목록에도 들어올 수 없다.
 *
 * 그래서 이름이 아니라 **혈통**으로 지운다. 우리 pid 의 자손이면 우리 책임이다.
 *
 * **macOS 한정이다.** Wooi 는 macOS 로만 배포하고(`npm run dist`), 아래의 헬퍼 제외 규칙이
 * `.app` 경로에 기대고 있다. 다른 플랫폼에서는 조용히 아무것도 하지 않는다 — 거기서
 * 잘못 판정해 Electron 헬퍼를 죽이는 편이 고아를 남기는 것보다 나쁘다.
 */

/** SIGTERM 을 보낸 뒤 살아남은 것을 확인하기까지 기다리는 시간. */
const TERM_GRACE_MS = 300

interface ProcRow {
  pid: number
  ppid: number
  command: string
}

/**
 * `ps` 한 줄을 파싱한다. command 에 공백이 있으므로(`.../Wooi Helper.app/...`) 앞의 두 칸만
 * 나누고 나머지는 통째로 명령으로 본다.
 */
function parseRow(line: string): ProcRow | null {
  const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
  if (!m) return null
  return { pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }
}

export function parsePsOutput(stdout: string): ProcRow[] {
  return stdout.split('\n').flatMap((line) => {
    const row = parseRow(line)
    return row ? [row] : []
  })
}

/**
 * 죽이면 안 되는 자손인가.
 *
 * 둘뿐이다:
 *
 * 1. **Electron 헬퍼** — 렌더러·GPU·네트워크·utilityProcess 호스트. 전부 번들의
 *    `Contents/Frameworks/` 아래에 있고 Electron 이 스스로 내린다. 제외를 이보다 넓게(번들
 *    전체로) 잡으면 안 된다 — 번들로 함께 실린 `claude` CLI 가 `Contents/Resources/
 *    app.asar.unpacked/` 에 있어서 같이 살아남고, 그게 바로 고아의 뿌리다.
 * 2. **업데이터 헬퍼** — Squirrel.Mac 의 ShipIt. 우리를 교체하려고 우리가 사라지기를 기다리는
 *    프로세스라, 여기서 죽이면 업데이트가 조용히 실패한다. launchd 가 물려받는 것이 보통이라
 *    애초에 자손이 아닐 때가 많지만, 넘겨받기 직전의 창을 믿고 갈 이유가 없다.
 */
function isImmune(command: string, helperPrefix: string): boolean {
  if (helperPrefix && command.startsWith(helperPrefix)) return true
  return /ShipIt|Squirrel/.test(command)
}

/**
 * `rootPid` 의 자손 pid 를 모은다. 면역인 프로세스는 **자신만** 건너뛰고 자식은 계속 따라간다.
 *
 * 노드 단위 제외가 핵심이다. utilityProcess 헬퍼는 건드리면 안 되지만 그 헬퍼가 띄운
 * `claude` CLI 와 그 CLI 가 띄운 손자는 우리가 죽여야 하기 때문이다.
 */
export function descendantsOf(rows: ProcRow[], rootPid: number, helperPrefix: string): number[] {
  const childrenOf = new Map<number, ProcRow[]>()
  for (const row of rows) {
    const siblings = childrenOf.get(row.ppid)
    if (siblings) siblings.push(row)
    else childrenOf.set(row.ppid, [row])
  }

  const doomed: number[] = []
  const seen = new Set<number>([rootPid])
  const queue = [rootPid]
  while (queue.length > 0) {
    const pid = queue.shift() as number
    for (const child of childrenOf.get(pid) ?? []) {
      // ppid 가 자기 자신인 행이나 순환이 들어와도 무한 루프에 빠지지 않게 한다.
      if (seen.has(child.pid)) continue
      seen.add(child.pid)
      queue.push(child.pid)
      if (isImmune(child.command, helperPrefix)) continue
      doomed.push(child.pid)
    }
  }
  // 잎부터 죽이면 중간 노드가 사라지며 손자가 launchd 로 입양되는 창이 좁아진다.
  return doomed.reverse()
}

/**
 * Electron 헬퍼들이 사는 디렉터리(`/Applications/Wooi.app/Contents/Frameworks/`).
 * 개발 실행에서는 electron 자신의 번들이 잡힌다. `.app` 이 없으면 빈 문자열 — 그때는
 * 헬퍼를 가려낼 방법이 없으므로 아무것도 제외하지 않는다.
 */
function helperPrefix(): string {
  const marker = '.app/'
  const at = process.execPath.indexOf(marker)
  if (at === -1) return ''
  return `${process.execPath.slice(0, at + marker.length - 1)}/Contents/Frameworks/`
}

/** SIGTERM 을 무시하는 자식에게 마지막으로 한 번 더. 종료가 300ms 늦어지는 값은 지불한다. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig)
  } catch {
    // 이미 사라졌거나 우리 것이 아니다.
  }
}

/**
 * 지금 살아 있는 자손을 전부 내린다. 앱 종료의 마지막 단계(`will-quit`)에서 한 번 부른다.
 *
 * 동기다. 여기서 await 하면 Electron 이 먼저 프로세스를 끝내 버려 아무것도 못 죽인다.
 */
export function reapDescendants(): void {
  if (process.platform !== 'darwin') return
  let rows: ProcRow[]
  try {
    // -ww: 폭에 맞춰 명령을 자르지 않는다. 잘리면 번들 경로 판정이 어긋난다.
    const stdout = execFileSync('ps', ['-axww', '-o', 'pid=,ppid=,args='], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024
    })
    rows = parsePsOutput(stdout)
  } catch (err) {
    log.error('reaper: failed to read the process table', err)
    return
  }

  const doomed = descendantsOf(rows, process.pid, helperPrefix())
  if (doomed.length === 0) return

  log.info(`reaper: terminating ${doomed.length} leftover descendant(s)`)
  for (const pid of doomed) signal(pid, 'SIGTERM')

  sleepSync(TERM_GRACE_MS)
  const survivors = doomed.filter(alive)
  if (survivors.length === 0) return
  log.warn(`reaper: ${survivors.length} descendant(s) ignored SIGTERM — killing`)
  for (const pid of survivors) signal(pid, 'SIGKILL')
}
