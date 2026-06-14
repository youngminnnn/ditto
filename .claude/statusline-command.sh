#!/usr/bin/env bash
# Claude Code status line script
# Displays: git branch | current directory | context usage

input=$(cat)

# Current directory (basename)
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
dir_name=$(basename "$cwd")

# Git branch (from cwd, skip optional locks)
branch=""
if git_branch=$(git -C "$cwd" -c gc.auto=0 symbolic-ref --short HEAD 2>/dev/null); then
  branch="$git_branch"
fi

# Context usage
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
total_input=$(echo "$input" | jq -r '.context_window.total_input_tokens // empty')
ctx_size=$(echo "$input" | jq -r '.context_window.context_window_size // empty')

# Build status parts
parts=""

# Branch segment
if [ -n "$branch" ]; then
  parts="${parts}$(printf '\033[36m')branch:${branch}$(printf '\033[0m')"
fi

# Directory segment
if [ -n "$dir_name" ]; then
  [ -n "$parts" ] && parts="${parts}  "
  parts="${parts}$(printf '\033[33m')dir:${dir_name}$(printf '\033[0m')"
fi

# Context segment
if [ -n "$used_pct" ] && [ -n "$total_input" ] && [ -n "$ctx_size" ]; then
  used_pct_rounded=$(printf '%.0f' "$used_pct")
  parts="${parts}  $(printf '\033[35m')ctx:${total_input}/${ctx_size} (${used_pct_rounded}%)$(printf '\033[0m')"
elif [ -n "$used_pct" ]; then
  used_pct_rounded=$(printf '%.0f' "$used_pct")
  parts="${parts}  $(printf '\033[35m')ctx:${used_pct_rounded}%$(printf '\033[0m')"
fi

printf "%s" "$parts"
