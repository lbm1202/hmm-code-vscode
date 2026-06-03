# Releasing

Every push of a `vX.Y.Z` tag triggers `.github/workflows/release.yml`. CI clones `hmm-code-pi`, builds the .vsix, creates a GitHub Release, and attaches the .vsix as a download.

## Cutting a release

```bash
# 1. Bump the version
$EDITOR package.json   # bump "version"
$EDITOR CHANGELOG.md   # move [Unreleased] entries under the new version + add a fresh empty [Unreleased]
git commit -am "release: 0.1.1"
git push

# 2. Tag and push (workflow auto-runs)
git tag v0.1.1
git push origin v0.1.1
```

Inside ~1 minute the workflow publishes:
- A GitHub Release at <https://github.com/lbm1202/hmm-code-vscode/releases/tag/v0.1.1>
- `hmm-code-0.1.1.vsix` attached for direct download

The release notes are composed by the workflow from **CHANGELOG.md** — it extracts the section for the tagged version (everything between `## [X.Y.Z]` and the next `## [` heading), prepends a `## hmm-code X.Y.Z` header, and appends the Install boilerplate + the auto-generated commit list (`generate_release_notes: true`). **CHANGELOG.md is the single source of truth for the Release page** — write the rich notes there (an optional `### ✨ Highlights` subsection carries over verbatim). No manual `gh release edit` needed. If no matching CHANGELOG section is found the body falls back to Install boilerplate only (and CI logs a warning).

## Dependency updates

`.github/dependabot.yml` opens PRs every Monday for:
- `@earendil-works/*` (Pi runtime + related)
- `dompurify`, `marked`, `shiki` (webview runtime deps)

Workflow when a Dependabot PR appears:

1. **Review the diff** — usually just `package.json` + `package-lock.json` bumps.
2. **Sanity-check the change** — for `@earendil-works/pi-coding-agent`, read the upstream release notes for any breaking changes to the extension API (rare in the 0.7x series, but worth checking).
3. **Merge the PR.**
4. **Tag + release** as above (`0.1.x` for patch bumps, `0.2.0` for anything user-visible).

## Smoke test (manual)

`.github/workflows/ci.yml` already runs `tsc --noEmit` + `npm test` on every push and PR, so a green main covers the first two checks below. Before tagging, at minimum verify:

- [ ] `./node_modules/.bin/tsc --noEmit` reports 0 errors.
- [ ] `npm test` passes.
- [ ] `npm run build` succeeds locally without warnings.
- [ ] `npx @vscode/vsce package` produces a `.vsix` under 30 MB.
- [ ] Install the local `.vsix` over the previous one: `code --install-extension hmm-code-X.Y.Z.vsix --force`.
- [ ] Reload the VS Code window. Open the Hmm-code sidebar. Send "hello" to the active model — response arrives.
- [ ] Open the settings panel. Models list is populated.
- [ ] In the `Hmm-code` output channel, the launch source line reads `bundled`.

For a more thorough pass, run the user-visible scenarios in [USER_GUIDE.md](docs/USER_GUIDE.md) (mode picker, model picker, plan handoff via `finalize_plan`, permission confirm modal, session picker rename + delete).

## Hot-fix release

For a critical bug fix between scheduled releases:

```bash
# Fix on main, no version bump yet
git commit -am "fix: <something critical>"
git push

# Hot-fix tag
$EDITOR package.json   # bump patch only — e.g. 0.1.0 → 0.1.1
$EDITOR CHANGELOG.md   # add the entry
git commit -am "release: 0.1.1 (hotfix)"
git push
git tag v0.1.1
git push origin v0.1.1
```

The release shows up in ~1 minute via the same workflow.

## Versioning rules

Pre-1.0 SemVer:
- `0.X.0` — anything user-visible (new features, behavior changes, removed features). Treat as a "minor" bump.
- `0.X.Y` — pure bug fixes / docs / internal cleanup.
- Breaking changes to the user-facing UX → bump `X` and call it out in the release notes.

## Failure recovery

If the workflow fails:

- **Version mismatch**: Workflow's `Verify package.json version matches tag` step failed. Bump `package.json` to match the tag (or use a fresh tag matching the existing version), then re-push.
- **Build fails**: Look at the workflow logs. Most causes are dependency resolution (try a fresh `npm install` locally to reproduce).
- **`hmm-code-pi` clone fails**: Confirm the repo is publicly accessible at <https://github.com/lbm1202/hmm-code-pi>. (If it's private, the workflow needs auth — re-introduce a PAT step.)

The release tag can be safely re-used by deleting both the tag and the GitHub Release, then re-pushing.
