/**
 * Ditto 로고. "ditto" = 복제/분신 컨셉을 겹쳐 쌓인 둥근 사각형(병렬 복제된 workspace)으로 표현한다.
 * 파랑→보라 그라데이션은 앱의 강조색(파랑 액션, 보라 PR)과 맞춘다.
 */
export default function Logo({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Ditto"
    >
      <defs>
        <linearGradient id="ditto-logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6ea8fe" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect x="3.5" y="3.5" width="18" height="18" rx="5.5" fill="url(#ditto-logo-grad)" opacity="0.35" />
      <rect x="10.5" y="10.5" width="18" height="18" rx="5.5" fill="url(#ditto-logo-grad)" />
    </svg>
  )
}
