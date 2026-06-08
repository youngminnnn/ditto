# Ditto

**English** · [한국어](./README.ko.md)

A desktop app for orchestrating multiple **AI coding agents** in parallel, each on
its own isolated git worktree. Each task runs in its own dedicated worktree + branch
+ agent session, and every session starts with **an empty input box and no automatic
prompt** — nothing runs until you send your first message.

> **Agent support** — Ditto currently drives **Claude Code** (via the Claude
> Agent SDK). Support for more agents such as **Codex** is planned.

## Concept

- **Repository** — connect a git repo (its main checkout).
- **Workspace** — one task = one dedicated git worktree + branch + agent session,
  created under `~/ditto/workspaces/<repo>/<branch>`.
- Each workspace runs **independently and in parallel** — while an agent works in one
  workspace, you can open another and keep going.
- **Setup / Dev / Archive scripts** — configured per repo (`npm install`, `npm run dev`,
  etc.). Setup runs automatically when a workspace is created (optional), Dev is
  started/stopped from the script panel, and Archive runs once when a workspace is
  archived.

## Getting started

When you first launch Ditto, onboarding walks you through:

1. **Consent** to the Terms / Privacy Policy (required to continue).
2. **Signing in** to Claude (`claude auth`) and GitHub (`gh auth`). If a CLI isn't
   installed, an install link is shown. Sign-in flows run in Terminal, and you can
   change connections anytime under **Settings → Integrations**.

Ditto **reuses the credentials of your installed Claude Code and `gh` CLIs** — no
separate API key is needed.

### Requirements

- macOS (Apple Silicon)
- [Claude Code](https://claude.com/claude-code) — required, and signed in.
- `git`
- `gh` (GitHub CLI) — optional; only needed for viewing/creating PRs and CI checks.

## Features

### Workspaces

- **No default prompt** — the input box starts empty; the session begins only when you
  send your first message.
- **Automatic creation** — workspaces get an auto-generated name (like
  `witty-otter`) and branch off the repo's default branch. Turn on **manual setup** in
  Settings to choose the name and base branch yourself. Rename a workspace by
  double-clicking its name in the header.
- **Per-workspace model override** (header dropdown). When unset it follows the global
  setting; changing it resumes the same conversation.
- **Sessions resume across restarts** — your conversation context is restored, so the
  next message after a restart continues where you left off.

### Permissions

- **Cycle permission modes with Shift+Tab** (same as Claude Code): default → accept
  edits → plan → auto. The current mode is shown below the input box.
- Permission prompts offer **"Always allow"** (auto-approve that tool for the rest of
  the session) alongside Allow/Deny — Enter = Allow, Esc = Deny.

### Parallel-session visibility

- The sidebar distinguishes **running** (spinner), **awaiting permission** (yellow
  shield), and **unread responses** (blue dot).
- When the window is inactive, completions / errors / permission requests appear as OS
  notifications and a Dock badge count.
- The **"Needs input" / "Next unread"** buttons above the input box jump straight to the
  session that needs you.

### Work area

A tabbed panel on top plus an interactive terminal below (resizable split):

- **All files** — a file tree of the worktree with a read-only, syntax-highlighted
  viewer.
- **Changes** — a per-file diff against the base branch (same meaning as a PR diff),
  covering commits + staged + unstaged + untracked files. The header summary
  (`N changed · ↑ahead · ↓behind`) opens this as a modal. When there's no PR and the
  branch is ahead, a **Create PR** button opens GitHub's PR page in your browser.
- **Check** — CI check results for the PR on the current branch.
- **Terminal** — a per-workspace login-shell terminal that survives workspace switches,
  so running commands and shell state are preserved when you return.

### Composing messages

- **Slash-command autocomplete** — type `/` to see the Claude Code commands/skills
  available in that worktree.
- **Draft preservation & message queueing** — an in-progress message survives workspace
  switches, and you can queue follow-up messages while a turn is running.
- **Shortcuts** — ↑/↓ to recall previous messages, ⌘1–9 and ⌘[ ⌘] to switch workspaces.

### Convenience

- **Open in editor / Reveal in Finder** — header buttons open the worktree in VS Code
  (`code`, falling back to Finder) or reveal it in Finder.

> Note: the diff viewer is read-only — no staging, commit, or revert from within Ditto.

## Privacy / Data

- Ditto has no servers of its own and **collects no analytics/telemetry**.
- Prompts and code are sent to **Anthropic** through the Claude Agent SDK. When you use
  the PR features, metadata is sent to **GitHub** via the `gh` CLI.
- Settings and conversation transcripts are stored **locally only**
  (`~/Library/Application Support/Ditto/`).
- See [`PRIVACY.md`](./PRIVACY.md) and [`TERMS.md`](./TERMS.md) for details.

## License

[MIT](./LICENSE) © youngminnnn. You are free to use, modify, and redistribute the
software under the terms of the MIT License.
