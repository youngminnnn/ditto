import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { WorkspaceTab } from '@shared/types'
import TabStrip from './TabStrip'

/**
 * 이 컴포넌트는 상태를 들지 않는다 — 목록의 주인은 main 이고 구독은 `App` 이 한 번만 한다.
 * 그래서 여기서 지킬 것은 **표기와 조작의 계약** 둘뿐이다: 작업 탭은 닫을 수 없다는 것,
 * 그리고 이름 없는 탭이 주소에서 읽을 만한 라벨을 만든다는 것.
 */

const work: WorkspaceTab = { id: 'work', kind: 'work' }
const dev: WorkspaceTab = { id: 't1', kind: 'dev', target: 'http://localhost:5173/settings' }

function renderStrip(tabs: WorkspaceTab[], activeId = 'work') {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  const onNew = vi.fn()
  render(
    <TabStrip tabs={tabs} activeId={activeId} onSelect={onSelect} onClose={onClose} onNew={onNew} />
  )
  return { onSelect, onClose, onNew }
}

describe('TabStrip', () => {
  it('작업 탭에는 닫기 버튼이 없다 — 닫을 수 없다는 것이 데이터 불변식이라 화면에도 없어야 한다', () => {
    renderStrip([work, dev])
    expect(screen.queryByRole('button', { name: 'Close Work' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Close / })).toBeInTheDocument()
  })

  it('탭을 누르면 그 id 로 선택을 요청한다', () => {
    const { onSelect } = renderStrip([work, dev])
    fireEvent.click(screen.getByRole('tab', { name: /localhost:5173/ }))
    expect(onSelect).toHaveBeenCalledWith('t1')
  })

  it('닫기를 누르면 그 id 로 닫기를 요청한다', () => {
    const { onClose } = renderStrip([work, dev], 't1')
    fireEvent.click(screen.getByRole('button', { name: /^Close / }))
    expect(onClose).toHaveBeenCalledWith('t1')
  })

  it('활성 탭만 aria-selected 가 참이다', () => {
    renderStrip([work, dev], 't1')
    expect(screen.getByRole('tab', { name: 'Work' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: /localhost:5173/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('이름이 없으면 주소에서 호스트:포트를 뽑아 쓴다 — 전체 URL 은 탭 폭에 안 들어간다', () => {
    renderStrip([work, dev])
    expect(screen.getByRole('tab', { name: 'localhost:5173' })).toBeInTheDocument()
  })

  it('주소가 URL 이 아니면 마지막 경로 조각을 쓴다', () => {
    renderStrip([work, { id: 't2', kind: 'file', target: 'src/main/preview.ts' }])
    expect(screen.getByRole('tab', { name: 'preview.ts' })).toBeInTheDocument()
  })

  it('새 탭 버튼은 종류를 고르게 한다 — 아티팩트는 여기 말고 다시 열 입구가 없다', () => {
    const { onNew } = renderStrip([work])
    fireEvent.click(screen.getByRole('button', { name: 'New tab' }))

    fireEvent.click(screen.getByRole('button', { name: 'New web tab' }))
    expect(onNew).toHaveBeenCalledWith('web')

    fireEvent.click(screen.getByRole('button', { name: 'New tab' }))
    fireEvent.click(screen.getByRole('button', { name: 'Artifacts' }))
    expect(onNew).toHaveBeenCalledWith('artifact')
  })

  it('새 탭 메뉴는 오른쪽 끝에 붙는다 — 왼쪽 기준으로 펴면 창 밖으로 나가 잘린다', () => {
    renderStrip([work])
    fireEvent.click(screen.getByRole('button', { name: 'New tab' }))
    const panel = screen.getByRole('button', { name: 'New web tab' }).parentElement
    expect(panel?.className).toContain('right-0')
    expect(panel?.className).not.toContain('left-0')
  })

  it('사용자가 붙인 이름이 있으면 그것이 이긴다', () => {
    renderStrip([work, { ...dev, title: '대시보드' }])
    expect(screen.getByRole('tab', { name: '대시보드' })).toBeInTheDocument()
  })
})
