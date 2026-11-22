#!/usr/bin/env bash
#
# Prints the apps whose CI must run for the commits between two revisions.
#
# Usage: changed-apps.sh <base> <head>
#   base  Revision before the change: a pull request's base SHA, or the SHA
#         that a push replaced. All zeros (a new branch) selects every app.
#   head  Revision after the change.
#
# Compares the merge base of <base> and <head> with <head>, so commits that
# reached the base branch after the branch point are not counted. Both
# revisions and their merge base must be in the local clone (in Actions:
# actions/checkout with fetch-depth: 0). Reads commits only, never the
# working tree.
#
# An app is a directory apps/<app>/ that holds a package.json in <head>.
# An app is selected when a file under apps/<app>/ differs. Every app is
# selected when a path in SHARED_PATHS differs.
#
# Output: one line of JSON on stdout, the selected app directory names in
# byte order, for example ["app-a","app-b"]. [] when no app is selected.
#
# Exit codes:
#   0  the array was printed
#   1  git or jq is missing, a revision or the merge base cannot be
#      resolved, <head> has no apps, or git diff failed
#   2  wrong number of arguments

set -euo pipefail

# Files and directories that every app's CI depends on. A change to any of
# them selects every app. A shared code directory is one more entry here.
SHARED_PATHS=(
  ".github/workflows/ci.yml"
  ".github/scripts/changed-apps.sh"
)

fail() {
  echo "changed-apps: $1" >&2
  exit 1
}

if (( $# != 2 )); then
  echo "usage: changed-apps.sh <base> <head>" >&2
  exit 2
fi

for tool in git jq; do
  command -v "$tool" >/dev/null || fail "$tool is not installed"
done

cd "$(git rev-parse --show-toplevel)"

resolve() {
  git rev-parse --verify --quiet --end-of-options "$1^{commit}" ||
    fail "'$1' is not a commit in this clone; fetch full history (actions/checkout fetch-depth: 0)"
}

head=$(resolve "$2")

# App directories as paths from the repo root: apps/<app>.
apps=()
while IFS= read -r -d '' dir; do
  if git cat-file -e "$head:$dir/package.json" 2>/dev/null; then
    apps+=("$dir")
  fi
done < <(git ls-tree -d -z --name-only "$head" apps/)
(( ${#apps[@]} > 0 )) || fail "no apps/<app>/package.json in $head"

# Succeeds when a path under the given pathspecs differs between $from and
# $head.
differs() {
  local status=0
  git --literal-pathspecs diff --quiet "$from" "$head" -- "$@" || status=$?
  (( status <= 1 )) || fail "git diff failed with exit code $status"
  (( status == 1 ))
}

selected=()
if [[ "$1" =~ ^0+$ ]]; then
  selected=("${apps[@]}")
else
  base=$(resolve "$1")
  from=$(git merge-base "$base" "$head") ||
    fail "no merge base for $base and $head; fetch full history (actions/checkout fetch-depth: 0)"
  if differs "${SHARED_PATHS[@]}"; then
    selected=("${apps[@]}")
  else
    for dir in "${apps[@]}"; do
      if differs "$dir/"; then
        selected+=("$dir")
      fi
    done
  fi
fi

# Every argument after --args starts with "apps/", so jq reads none of them
# as an option. ${selected[@]+...}: bash before 4.4 treats an empty array as
# unset under set -u.
jq -cn '$ARGS.positional | map(ltrimstr("apps/"))' \
  --args ${selected[@]+"${selected[@]}"}
