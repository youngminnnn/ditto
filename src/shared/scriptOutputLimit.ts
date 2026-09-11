/**
 * 스크립트 로그 꼬리의 상한. **메인과 렌더러가 같은 값을 써야 한다.**
 *
 * 출력은 이벤트로만 흘러가고, 메인과 렌더러가 각자 자기 버퍼에 쌓는다. 메인은 처음부터
 * 꼬리만 남겼는데 렌더러에는 상한이 없었다 — 그래서 수다스러운 dev 서버를 몇 시간 켜 두면
 * 메인은 256KiB 에 머무는 동안 렌더러의 같은 문자열만 한 방향으로 자랐다. 게다가 그 문자열은
 * 스크립트 패널이 `<pre>` 하나에 통째로 그리므로, 자란 만큼 DOM 텍스트 노드도 자랐다.
 *
 * 상한을 한곳에 두는 것이 요점이다. 두 벌로 두면 한쪽만 고쳐지는 날이 오고, 그날 다시
 * 같은 병이 된다.
 */
export const SCRIPT_OUTPUT_LIMIT = 256 * 1024

/** 꼬리 버퍼에 이어 붙인다. 상한을 넘으면 앞을 잘라 최신 부분만 남긴다. */
export function appendScriptTail(prev: string, chunk: string): string {
  const next = prev + chunk
  return next.length > SCRIPT_OUTPUT_LIMIT ? next.slice(-SCRIPT_OUTPUT_LIMIT) : next
}
