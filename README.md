# Ditto

**English** · [한국어](./README.ko.md)

A desktop app for orchestrating parallel Claude Code agents on top of isolated
git worktrees. It follows the [Conductor](https://conductor.build) concept but is
**Claude Code only**, and a new session starts with **an empty input box and no
automatic prompt**.

## Concept

- **Repository** — connect a git repo (its main checkout).
- **Workspace** — one task = one dedicated git worktree + branch + Claude Code
  session. Worktrees are created under `~/ditto/workspaces/<repo>/<branch>`.
- Each workspace's session runs **independently and in parallel**. While an agent
  is working in one workspace, you can open another and keep working.
- **Setup / Dev / Archive scripts** — configured per repo (`npm install`,
  `npm run dev`, etc.). Setup runs automatically when a workspace is created
  (optional), Dev is started/stopped from the script panel, and the Archive
  script runs once when a workspace is archived.

## How it works

- **No default prompt on the first session** — the input box starts empty, and the
  session only begins once you send your first message (nothing runs automatically).
- **Claude Code only** — no other agents are supported.
- **The UI is in English** (code comments stay in Korean).
- **First-run onboarding** — ① **consent** to the Terms / Privacy Policy (you can't
  proceed without it) → ② guidance for signing in to Claude (`claude auth`) and
  GitHub (`gh auth`). If a CLI isn't installed, an install link is shown. You can
  change connections anytime under Settings → Integrations; sign-in flows run in
  Terminal.
- **Automatic workspace creation** — names are auto-generated (friendly slugs like
  `witty-otter`) and the base is the repo's default branch (main/origin). Turning on
  "manual setup" in Settings shows a modal for entering the name and base branch.
  Rename a workspace by double-clicking its name in the header.
- **Cycle permission modes with Shift+Tab** (same as Claude Code): default → accept
  edits → plan → auto. The current mode is shown below the input box. Permission
  prompts offer "Always allow" (auto-approve that tool for the rest of the session)
  in addition to Allow/Deny, with Enter = Allow and Esc = Deny shortcuts.
- **Parallel-session visibility** — the sidebar distinguishes running (spinner),
  awaiting-permission (yellow shield), and unread responses (blue dot). When the
  window is inactive, completions / errors / permission requests are surfaced as OS
  notifications and counted in a Dock badge; the "Needs input" / "Next unread"
  buttons above the input box jump straight to the relevant session.
- **Right-side work area** — a tabbed panel on top plus an interactive terminal
  below (resizable split):
  - **All files** — a lazy file tree of the worktree with a read-only viewer
    (syntax-highlighted, `.git` hidden, escapes blocked).
  - **Changes** — a per-file diff against the base branch (merge-base, same meaning
    as a PR diff), covering commits + staged + unstaged + untracked files. The
    branch summary in the header (`N changed · ↑ahead · ↓behind`) also opens this as
    a modal. When there's no PR and the branch is ahead, a "Create PR" button opens
    the GitHub PR creation page in the browser.
  - **Check** — CI check results for the PR on the current branch.
  - **Terminal** — a per-workspace login-shell PTY that survives workspace switches,
    so a running command and shell state are preserved when you come back.
- **Slash-command autocomplete** — type `/` in the composer to get a menu of the
  Claude Code commands/skills available in that worktree (queried lazily and cached).
- **Per-workspace model override** (header dropdown). When unset it follows the
  global setting. Changing the model restarts the underlying query and resumes the
  same conversation via the session ID.
- **Draft preservation & message queueing** — an in-progress message survives
  workspace switches, and you can queue follow-up messages while a turn is running
  (it's processed after the current turn). Use ↑/↓ to recall previous messages, and
  ⌘1–9 / ⌘[ ⌘] to switch workspaces.
- **Session resume across restarts** — each workspace's Claude session ID is
  persisted, so the next message after a restart resumes the agent's conversation
  context (past messages aren't re-emitted, avoiding duplicate rendering).
- **Open in editor / Reveal in Finder** — header buttons open the worktree in VS
  Code (`code`, falling back to Finder) or reveal it in Finder.
- Authentication **reuses the credentials of your installed Claude Code and `gh`**
  (no separate API key needed). On launch the app hydrates `PATH` from your login
  shell so CLIs installed under `~/.local/bin` / Homebrew aren't seen as missing.

## Privacy / Data

- Ditto has no servers of its own and **collects no analytics/telemetry**.
- Prompts and code are sent to **Anthropic** through the Claude Agent SDK, and when
  you use the PR features, metadata is sent to **GitHub** via the `gh` CLI. Settings
  and conversation transcripts are stored **locally only**
  (`~/Library/Application Support/Ditto/`).
- See [`PRIVACY.md`](./PRIVACY.md) and [`TERMS.md`](./TERMS.md) for details (both are
  drafts pending legal review).

## Requirements

- macOS (Apple Silicon), Node 20+
- [Claude Code](https://claude.com/claude-code) — required, and signed in. The Agent
  SDK runs a bundled native binary and reuses the credentials in `~/.claude`. If it's
  not installed, onboarding shows an install link.
- `gh` (GitHub CLI) — optional; only needed for viewing/creating PRs and checks.
- `git`

## Develop / Build

```sh
npm install
npm run dev        # dev mode (HMR)
npm run typecheck  # type check (main + renderer)
npm run build      # production bundle (out/)
npm run dist       # macOS dmg + zip packaging, unsigned (release/)
```

### Distribution build (dmg)

- **A local dmg build mounts a disk image under `/Volumes`**, so in environments with
  media control / DLP (e.g. Office Keeper) the mount can be blocked and dmg packaging
  fails. In that case, **prefer a CI build**. (The `zip` target needs no mount, so it
  can be produced and run locally.)
- **GitHub Actions** — `.github/workflows/build.yml` builds an unsigned dmg/zip on a
  `macos-14` (Apple Silicon) runner and uploads them as artifacts. It triggers only on
  **manual dispatch (`workflow_dispatch`)** or a **`v*` tag push** (macOS runners on a
  private repo are expensive per minute). Download the result from the **Artifacts**
  section of the Actions run page, or with
  `gh run download <run-id> --name ditto-macos-arm64`.

## Architecture

Electron + React + TypeScript, built with electron-vite.

```
src/
├── shared/          # shared types + IPC contract between main↔renderer (SSOT)
│   ├── types.ts        # domain types + IPC channel names/payloads
│   └── api.ts          # the window.api surface exposed to the renderer
├── main/            # Electron main process
│   ├── index.ts        # app lifecycle / window / production CSP
│   ├── ipc.ts          # IPC handler registration
│   ├── env.ts          # hydrate PATH from the login shell (so CLIs are found)
│   ├── store.ts        # settings persistence (userData/ditto.json, schema-version migration)
│   ├── transcripts.ts  # per-workspace transcripts (append-only JSONL + LRU cache)
│   ├── fsutil.ts       # atomic file writes (temp + rename)
│   ├── fsbrowse.ts     # read-only worktree file browser (All files tab)
│   ├── git.ts          # worktree / branch / status / diff
│   ├── github.ts       # gh-CLI-based PR status / checks / create
│   ├── auth.ts         # claude/gh install & login status (PATH diagnostics on miss)
│   ├── names.ts        # friendly workspace name generator
│   ├── logger.ts       # main-process file logging (userData/logs/main.log)
│   ├── scripts.ts      # setup/dev/archive script runner (process-group kill)
│   ├── terminal.ts     # per-workspace interactive PTY (node-pty)
│   └── claude/
│       ├── session.ts     # Agent SDK streaming-input session wrapper
│       ├── manager.ts     # workspace→session lifecycle + permission routing
│       ├── commands.ts    # slash-command discovery (supportedCommands) for autocomplete
│       ├── executable.ts  # resolve the packaged native CLI path (app.asar.unpacked)
│       └── asyncQueue.ts
├── preload/         # contextBridge → window.api
└── renderer/        # React UI (zustand state)
```

- **Driving a session**: opens a single long-lived `query()` from
  `@anthropic-ai/claude-agent-sdk` in streaming-input mode. User messages are pushed
  onto the input queue to keep multi-turn context, and SDK messages
  (`stream_event`/`assistant`/`user`/`result`) are translated into UI events
  (including `thinking` blocks). The session is created lazily on the first message,
  and resumes from the persisted session ID when one exists.
- **Permissions**: the `canUseTool` callback is routed to the renderer to show
  allow/deny prompts. The permission mode is chosen per workspace (ask / accept edits
  / plan / auto); "auto" auto-approves without asking.
- **Data durability**: settings and transcripts are written atomically via
  [`fsutil`](src/main/fsutil.ts), and the settings file is migrated on load based on
  its `schemaVersion`. Production builds inject a strict CSP via response headers
  (`script-src 'self'`).

## Known limitations

- The diff viewer is read-only (no staging / commit / revert), and diffs are colored
  by line (+/−/hunk) without per-token language syntax highlighting.
- Build artifacts are **arm64 (Apple Silicon) only** and **unsigned**. External
  distribution requires signing + notarization (see the roadmap below).

## Next steps (external-distribution roadmap)

Work remaining before a public (free, downloadable) release:

1. **Code signing + notarization** — join the Apple Developer Program → issue a
   Developer ID Application certificate → inject it via repo Secrets (`CSC_LINK`,
   `CSC_KEY_PASSWORD`, and for notarization `APPLE_ID` /
   `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`) → enable signing + notarization
   (hardened runtime + entitlements) in the workflow's build step. **This is what lets
   a dmg downloaded from the web pass Gatekeeper** (the same applies to free apps).
2. **Auto-attach releases + auto-update** — once the certificate is ready, use
   `--publish always` with a token so a `v*` tag push uploads the dmg/zip to a GitHub
   Release, and wire up auto-update with `electron-updater` + `latest-mac.yml`.
3. **Pre-release finishing** —
   - Replace the placeholder URL (`github.com/ditto-app/ditto`) in
     `OnboardingModal.tsx` with the **real, publicly accessible document URLs**
     (private-repo links aren't visible to ordinary users).
   - Legal review of the Terms / Privacy Policy.

## License

Proprietary software. It may be installed and used for free, but redistribution and
reverse engineering are not permitted. See [`TERMS.md`](./TERMS.md) for details.
