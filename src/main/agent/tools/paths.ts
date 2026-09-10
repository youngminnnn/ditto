import { resolve, sep } from 'node:path'

/**
 * 모델이 준 경로를 워크트리 기준으로 되돌리는 자리.
 *
 * **모델은 방금 편집한 파일을 절대경로나 `./` 를 붙여 넘기는 일이 잦다.** 도구마다 그걸
 * 그대로 받으면 같은 파일이 서로 다른 문자열 셋(`/Users/…/src/a.ts`, `./src/a.ts`,
 * `src/a.ts`)이 되고, 그 문자열로 무언가를 대조하거나 키를 잡는 쪽이 조용히 어긋난다 —
 * `check_related_work` 는 겹침을 한 건도 못 찾고, 파일 탭은 같은 파일을 세 번 연다.
 *
 * 둘 다 "틀린 답" 이 아니라 **아무 말 없이 빗나가는** 종류라, 정규화를 한 곳에 모은다.
 */
export function toWorktreeRelative(raw: string, worktreePath: string): string {
  let path = raw.trim().replace(/\\/g, '/')
  const root = worktreePath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (path.startsWith(`${root}/`)) path = path.slice(root.length + 1)
  return path
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

/**
 * 정규화한 상대경로가 워크트리 **안에** 남는지 본다.
 *
 * 문자열에서 `../` 를 찾는 것으로는 부족하다 — `a/../../b` 처럼 중간에 끼면 접두사 검사를
 * 통과한다. 그래서 `resolve` 로 실제 경로를 만든 뒤 봉쇄를 확인한다([[artifacts]] dirFor 가
 * 같은 형태를 쓴다).
 *
 * 워크트리 자체(`rel === ''`)도 거절한다 — 파일을 여는 자리에 디렉터리가 오면 안 된다.
 */
export function isInsideWorktree(rel: string, worktreePath: string): boolean {
  if (!rel) return false
  const root = resolve(worktreePath)
  const full = resolve(root, rel)
  return full.startsWith(root + sep)
}
