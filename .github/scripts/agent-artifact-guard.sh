#!/bin/sh
# agent-artifact-guard
# Keeps agent operating artifacts (handoff logs, transcripts, session notes,
# agent-local state) out of this repository's history.
#
#   --tracked  check every tracked file (CI; default)
#   --staged   check the index before a commit (pre-commit hook)
#
# Exact paths listed in .github/agent-artifact-allowlist are exempt.
set -eu
# A closed stderr must never turn a block into a pass: ignore SIGPIPE so
# writes fail softly and the exit status below is always the one returned.
# (Under Git for Windows a hook killed by SIGPIPE reads as success.)
trap '' PIPE

mode="${1:---tracked}"

# Blocked at any depth.
anywhere='(^|/)(\.handoff/|\.specstory/|\.claude/|\.codex/|\.aider|bitacora[^/]*\.md$|handoff\.md$|[^/]*-handoff\.md$|claude\.local\.md$|task-contract[^/]*\.json$)'
# Blocked at the repository root only, so product folders such as
# src/features/chat/ or src/state/ stay allowed.
root_only='^(chat/|chat\.md$|handoffs/|transcripts?/|state/|scratch/)'
# Handoff records carry these keys.
marker='^[[:space:]]*(handoff_id|next_role):'
allowlist='.github/agent-artifact-allowlist'

case "$mode" in
  --tracked)
    paths=$(git ls-files)
    content=$(git grep -l -I -E "$marker" || true)
    ;;
  --staged)
    paths=$(git diff --cached --name-only --diff-filter=ACMR)
    content=$(git grep --cached -l -I -E "$marker" || true)
    ;;
  *)
    echo "usage: $0 [--tracked|--staged]" >&2
    exit 2
    ;;
esac

exempt() {
  if [ -f "$allowlist" ]; then
    grep -v -x -F -f "$allowlist" || true
  else
    cat
  fi
}

blocked=$(printf '%s\n' "$paths" | grep -i -E "$anywhere|$root_only" | exempt || true)
flagged=$(printf '%s\n' "$content" | grep -v '^$' | exempt || true)

say() { printf '%s\n' "$@" >&2 || :; }
list() { printf '%s\n' "$1" | sed 's/^/  /' >&2 || :; }

status=0
if [ -n "$blocked" ]; then
  status=1
  say "agent-artifact-guard: these paths are agent operating artifacts and must not be committed:"
  list "$blocked"
fi
if [ -n "$flagged" ]; then
  status=1
  say "agent-artifact-guard: these files contain handoff records (handoff_id / next_role):"
  list "$flagged"
fi
if [ "$status" -ne 0 ]; then
  say "Keep them in the local ledger, or list a deliberate exception in $allowlist."
fi
exit "$status"
