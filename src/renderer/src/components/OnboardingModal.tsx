import IntegrationsPanel from './IntegrationsPanel'
import Logo from './Logo'
import { primaryBtn } from './Modal'

export default function OnboardingModal({ onDone }: { onDone: () => void }): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60">
      <div className="no-drag w-[520px] max-w-[92vw] bg-[#15171c] border border-[#23262d] rounded-xl shadow-2xl overflow-hidden">
        <div className="px-6 pt-7 pb-2 text-center">
          <div className="mb-3 flex justify-center">
            <Logo size={56} />
          </div>
          <h2 className="text-lg font-semibold text-neutral-100">Welcome to Ditto</h2>
          <p className="mt-1.5 text-[12.5px] text-neutral-500 leading-relaxed">
            Run parallel Claude Code agents, each in its own isolated git worktree.
            <br />
            Connect your accounts to get started — you can change these later in Settings.
          </p>
        </div>

        <div className="px-6 py-4">
          <IntegrationsPanel />
        </div>

        <div className="px-6 py-4 border-t border-[#23262d] flex justify-end">
          <button className={primaryBtn} onClick={onDone}>
            Get started
          </button>
        </div>
      </div>
    </div>
  )
}
