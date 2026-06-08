import { writeFileSync, renameSync } from 'node:fs'

/**
 * 파일을 원자적으로 쓴다 — 임시 파일에 먼저 기록한 뒤 rename 으로 교체한다.
 * 같은 디렉토리(=같은 볼륨) 내 rename 은 원자적이므로, 쓰기 도중 크래시·전원 차단이
 * 나도 대상 파일이 반쪽 상태로 손상되지 않는다(직전 내용이 그대로 남는다).
 * 설정([[store]])·트랜스크립트([[transcripts]]) 처럼 손상되면 안 되는 영속 데이터에 쓴다.
 */
export function writeFileAtomic(filePath: string, data: string): void {
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, data, 'utf-8')
  renameSync(tmp, filePath)
}
