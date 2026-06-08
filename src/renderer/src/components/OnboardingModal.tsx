import { useState } from 'react'
import IntegrationsPanel from './IntegrationsPanel'
import Logo from './Logo'
import { primaryBtn } from './Modal'
import { CURRENT_TERMS_VERSION } from '@shared/types'

// 배포 시 실제 공개 URL 로 교체한다(현재는 앱과 함께 제공되는 repo 문서를 가리킨다).
const PRIVACY_URL = 'https://github.com/ditto-app/ditto/blob/main/PRIVACY.md'
const TERMS_URL = 'https://github.com/ditto-app/ditto/blob/main/TERMS.md'

/**
 * 최초 실행 온보딩. 첫 단계로 약관·개인정보처리방침 동의를 강제하고(미동의 시 진행 불가),
 * 동의가 끝나면 계정 연결(Claude/GitHub) 단계로 넘어간다.
 * 약관 버전이 올라가 재동의만 필요한 경우(이미 onboarded)에는 동의 단계만 보여준다.
 */
export default function OnboardingModal({
  needsConsent,
  needsOnboarding
}: {
  needsConsent: boolean
  needsOnboarding: boolean
}): React.JSX.Element {
  const [step, setStep] = useState<'consent' | 'integrations'>(
    needsConsent ? 'consent' : 'integrations'
  )

  // 동의 저장 후 계정 연결이 남았으면 다음 단계로. 아니면 settings 갱신으로 모달이 닫힌다.
  const acceptConsent = (): void => {
    void window.api.settings.update({ acceptedTermsVersion: CURRENT_TERMS_VERSION })
    if (needsOnboarding) setStep('integrations')
  }

  const finishOnboarding = (): void => {
    void window.api.settings.update({ onboarded: true })
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60">
      <div className="no-drag w-[520px] max-w-[92vw] bg-[#15171c] border border-[#23262d] rounded-xl shadow-2xl overflow-hidden">
        <div className="px-6 pt-7 pb-2 text-center">
          <div className="mb-3 flex justify-center">
            <Logo size={56} />
          </div>
          <h2 className="text-lg font-semibold text-neutral-100">Welcome to Ditto</h2>
          <p className="mt-1.5 text-[12.5px] text-neutral-500 leading-relaxed">
            Run parallel AI coding agents, each in its own isolated git worktree.
          </p>
        </div>

        {step === 'consent' ? (
          <ConsentStep onContinue={acceptConsent} />
        ) : (
          <IntegrationsStep onDone={finishOnboarding} />
        )}
      </div>
    </div>
  )
}

function ConsentStep({ onContinue }: { onContinue: () => void }): React.JSX.Element {
  const [agreed, setAgreed] = useState(false)

  const openDoc = (url: string) => (e: React.MouseEvent): void => {
    e.preventDefault()
    void window.api.openExternal(url)
  }

  return (
    <>
      <div className="px-6 py-4 text-[12.5px] text-neutral-400 leading-relaxed space-y-2">
        <p className="text-neutral-300">Before you start, here&rsquo;s how your data is handled:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Your prompts and code are sent to <b className="text-neutral-300">Anthropic</b> to be
            processed by Claude.
          </li>
          <li>
            If you use the GitHub features, repository data is sent to{' '}
            <b className="text-neutral-300">GitHub</b>.
          </li>
          <li>
            Settings and conversation transcripts are stored{' '}
            <b className="text-neutral-300">locally</b> on your Mac.
          </li>
          <li>
            Ditto has no servers and collects <b className="text-neutral-300">no analytics</b>.
          </li>
        </ul>
        <label className="flex items-start gap-2 pt-1.5 text-neutral-300 cursor-pointer">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I have read and agree to the{' '}
            <a href={PRIVACY_URL} onClick={openDoc(PRIVACY_URL)} className="text-blue-400 hover:underline">
              Privacy Policy
            </a>{' '}
            and{' '}
            <a href={TERMS_URL} onClick={openDoc(TERMS_URL)} className="text-blue-400 hover:underline">
              Terms of Use
            </a>
            .
          </span>
        </label>
      </div>

      <div className="px-6 py-4 border-t border-[#23262d] flex justify-end">
        <button
          className={primaryBtn + ' disabled:opacity-40 disabled:cursor-not-allowed'}
          disabled={!agreed}
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
    </>
  )
}

function IntegrationsStep({ onDone }: { onDone: () => void }): React.JSX.Element {
  return (
    <>
      <div className="px-6 py-4">
        <p className="mb-3 text-[12.5px] text-neutral-500 text-center leading-relaxed">
          Connect your accounts to get started — you can change these later in Settings.
        </p>
        <IntegrationsPanel />
      </div>

      <div className="px-6 py-4 border-t border-[#23262d] flex justify-end">
        <button className={primaryBtn} onClick={onDone}>
          Get started
        </button>
      </div>
    </>
  )
}
