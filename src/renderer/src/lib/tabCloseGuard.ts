/**
 * 탭을 닫으면 잃는 것이 있는지 판정하는 자리.
 *
 * 지금 있는 사정은 하나다 — 파일 탭의 **저장하지 않은 편집**. 예전 오버레이에는 닫기 버튼
 * 바로 옆에 묻는 가드가 있었는데, 탭은 **바깥**(탭 스트립의 ×, `⌘W`)에서 닫히므로 그 자리가
 * 사라졌다.
 *
 * 지식이 두 쪽에 나뉘어 있는 것이 요점이다. **어느 경로가 더러운지** 아는 것은 편집기이고,
 * **이 탭이 어느 경로를 가리키는지** 아는 것은 닫는 쪽이다. 그래서 편집기가 더러운 경로
 * 목록을 내놓고, 닫는 쪽이 자기 탭의 경로를 그 목록에 대조한다.
 *
 * 탭 id 로 걸지 않은 이유가 여기 있다. 파일 탭 컴포넌트는 인스턴스 하나가 경로를 갈아 끼우며
 * 산다(초안을 경로별로 들고 있어야 탭 사이를 오가도 고치던 내용이 남는다). 그래서 지금
 * 화면에 없는 탭의 편집도 그 인스턴스가 들고 있는데, 탭 id 로 걸면 **보고 있지 않은 탭을
 * 닫을 때** 그 편집이 조용히 사라진다.
 *
 * 스토어가 아니라 모듈 레지스트리인 이유: 이 값을 읽는 것은 닫기 경로 하나뿐이라 리렌더가
 * 필요 없다. 스토어에 넣으면 글자를 한 자 칠 때마다 앱이 다시 그려진다.
 */

type UnsavedPaths = () => string[]

const sources = new Set<UnsavedPaths>()

/** 저장하지 않은 경로를 내놓는 쪽(파일 탭)이 등록한다. 반환한 함수를 부르면 해제한다. */
export function registerUnsavedPaths(get: UnsavedPaths): () => void {
  sources.add(get)
  return () => {
    sources.delete(get)
  }
}

/** 이 경로에 저장하지 않은 편집이 있는가. */
export function isPathUnsaved(path: string): boolean {
  for (const get of sources) if (get().includes(path)) return true
  return false
}

/** 테스트용 초기화 — 모듈 상태가 케이스 사이에 새지 않게 한다. */
export function resetUnsavedPaths(): void {
  sources.clear()
}
