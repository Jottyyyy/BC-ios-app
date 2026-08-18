# Git workflow — a worktree per task, landing via PR

**What it does.** Keeps `main` clean and buildable by never working on it. Every bug fix and every feature
gets its own branch in its own git worktree; it lands on `main` through a pull request that the user merges.
This is the mechanical runbook — the binding rules are the **Workflow** section of [`../CLAUDE.md`](../CLAUDE.md).

**Why.** Before this, all 19 commits went straight to `main` — eight of them messaged `push` — and four
`Merge origin/main` commits exist purely because two machines (Windows for editing and the JS gate, macOS
for `swift build` and Xcode) both pushed `main` and collided. A branch per task removes the collision and
gives a diff to read before anything ships.

## Key files
- [`../CLAUDE.md`](../CLAUDE.md) — the ten rules. They are binding; this file is only the commands.
- [`../CHANGELOG.md`](../CHANGELOG.md) — read the **top** before starting; add an entry before landing.
- [`../.gitignore`](../.gitignore) — ignores `.claude/worktrees/`, so worktrees never show as untracked.
- [`../.gitattributes`](../.gitattributes) — pins text files to LF. Without it a fresh checkout gets CRLF
  and the Swift-source replay suites fail on strings alone. Do not remove it.

## 1 · Before you start
Read the newest entries at the top of `CHANGELOG.md` (it is 2500+ lines — read the top, never the whole
file), then `grep -n "<area>" CHANGELOG.md` for the thing you are about to touch. Then the matching
`docs/<area>.md`, and `PORTING_NOTES.md` for any `Sources/` work.

Make sure `main` is pushed — worktree branches are cut from `origin/main`, so unpushed local commits would
be silently left behind:

```bash
git fetch origin
git rev-parse main origin/main     # the two hashes must match
```

## 2 · Open the worktree

```bash
git worktree add ".claude/worktrees/<slug>" -b fix/<slug> origin/main
```

Quote the path — this repo lives under `D:\SAAS PROJECT\…`, which has a space. Prefixes: `fix/`, `feat/`,
`docs/`.

The `EnterWorktree` tool does the same thing *and* moves the session into the worktree, which is what an
assistant actually needs. Two caveats, both real:

- **It rewrites the name.** `EnterWorktree {name: "fix/foo"}` produces the directory `fix+foo` on the branch
  `worktree-fix+foo`, not `fix/foo`. Rename it immediately, from inside the worktree:
  `git branch -m fix/foo`.
- **It isolates the shell.** A worktree session refuses any command it cannot prove stays inside the
  worktree — no `cd`, no `/tmp`, no long `&&` chains with redirects, and not even `grep -c $'\r' file`.
  Use plain, separate commands and worktree-relative paths.

It defaults to `worktree.baseRef: fresh` (branch from `origin/main`). Setting `worktree.baseRef: head`
branches from local HEAD instead — only useful when you deliberately want to stack on unpushed work.

## 3 · Set up a fresh worktree
A worktree contains **only tracked files**, so everything in `.gitignore` is missing. Worse, anything that
finds the sibling Laravel repo by relative path breaks: a worktree sits three levels deep, so the oracle's
`tools/oracle/../../..` resolves to `.claude/worktrees/` instead of `D:\SAAS PROJECT\BYAHERONG-COACH`.

```bash
export LARAVEL_ROOT="D:/SAAS PROJECT/BYAHERONG-COACH/BYAHERONG-COACH-LARAVEL"
php tools/oracle/generate_goldens.php   # Goldens/ is gitignored and does NOT come along
php tools/eco/build_eco.php             # Goldens/eco_lookup.json + eco_book.tsv
```

| Symptom | Cause | Fix |
|---|---|---|
| `MISSING Goldens/game_review.json` | `Goldens/` is gitignored | `php tools/oracle/generate_goldens.php` |
| `MISSING Goldens/eco_lookup.json` | same | `php tools/eco/build_eco.php` |
| `WARNING: skipping the san_parse + pgn_tokens goldens` | `LARAVEL_ROOT` unset; the relative lookup fails from a worktree | set `LARAVEL_ROOT` and re-run. **Never ignore this** — it is a warning, not an error, and it silently truncates the goldens. `ParityRunner` then fails its `san_parse`/`pgn_tokens` floors. |
| `FATAL: cannot find the real ChessEngine` | same, but from `build_eco.php` | same |

`build_eco.php` rewrites two **tracked** files — `DemoApp/Sources/BiyaherongUI/ECO/eco.tsv` and
`web-demo/js/eco-data.js`. Check `git status` afterwards; if `git diff --stat` on them is empty,
`git checkout --` them. Regenerating them is not part of your change.

`DemoApp/Sources/BiyaherongUI/puzzles.sqlite` **is** tracked and comes along. There is no `npm install` —
the `tools/qa` suite is dependency-free Node. `.build/` is absent, so the first `swift build` is cold.

## 4 · Do the work, then log it
Update `CHANGELOG.md` (new entry at the top, under `## [Unreleased]`, shaped
`### YYYY-MM-DD (added|changed|fixed|docs) — Title`), the feature's `docs/<feature>.md`, and `web-demo/`
if the change is user-facing. Commit them together — `fix:` / `feat:` / `docs:` + an imperative subject.

## 5 · Run the gate before you land

```bash
node tools/qa/js_goldens.js          # every JS suite + oracle replays + Swift cross-checks
node tools/qa/swift_lint.js          # run with NO arguments — narrowing degrades it
node tools/qa/swift_symbol_check.js  # ditto
swift run ParityRunner               # macOS only; must exit 0
```

CI (`codemagic.yaml`) has no `triggering:` block and runs **none** of these — both workflows are started by
hand and only build the iOS app. A red gate merged is a regression shipped.

If a Replay suite fails on **string contents alone** while your diff touched no Swift, suspect line endings
before you suspect the code: `file <the .swift file>` should say LF, not CRLF. That is what `.gitattributes`
is there to prevent.

## 6 · Land it

```bash
git push -u origin fix/<slug>
```

`gh` is not installed on the Windows box, so hand the user the compare link and let them open and merge
the PR — the CHANGELOG entry is the PR body:

```
https://github.com/Jottyyyy/BC-ios-app/compare/main...fix/<slug>?expand=1
```

If `gh` is ever installed, `gh pr create --fill` replaces both steps. **Never `git push origin main`.**

## 7 · Clean up after the merge

```bash
git worktree list                              # what is still around
git worktree remove ".claude/worktrees/<slug>"
git branch -d fix/<slug>
git worktree prune                             # clears entries whose directory is already gone
```

`ExitWorktree {action: "remove"}` does the same for a tool-created worktree; it refuses while there are
uncommitted or unmerged changes unless you pass `discard_changes: true`. A stale worktree holds stale
`Goldens/` and gets edited by mistake — remove it.

## How to test this doc
Follow it end to end on a throwaway change: the worktree appears in `git worktree list`, `git status` in the
main checkout stays clean of `.claude/` noise, `node tools/qa/js_goldens.js` exits 0, the compare link opens
a PR with the right diff, and after cleanup `git worktree list` shows only the main checkout.
