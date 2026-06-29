# Builder Report - WC-V1-0002 v0.1.2 Release Publication Baseline

## Final Baseline Classification

COMPLETE - tag, local artifact, GitHub Release, and expected release asset payload are verified.

Note: the local artifact filename is `ChampCity GPT MCP Launcher-0.1.2-x64.exe`. The attached GitHub Release asset name returned by `gh` is `ChampCity.GPT.MCP.Launcher-0.1.2-x64.exe`; its size and SHA-256 digest match the expected local package artifact.

## Repository Identity

- Repository path inspected: `C:\Users\<you>\Projects\ChampCity_GPT` (sanitized; actual local path matched the expected project folder)
- Git top level: `C:/Users/<you>/Projects/ChampCity_GPT` (sanitized; actual local path matched the expected project folder)
- Remote inspected: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- Branch inspected: `main`
- Starting git status: clean (`git status --short` returned no output)
- `AGENTS.MD`: present
- `package.json`: present

## Commands Run And Results

- `pwd`: pass, `C:\Users\<you>\Projects\ChampCity_GPT` (sanitized)
- `git rev-parse --show-toplevel`: pass, `C:/Users/<you>/Projects/ChampCity_GPT` (sanitized)
- `git remote -v`: pass, origin fetch/push both reference `ChampCityChris/ChampCity_GPT_MCP`
- `git branch --show-current`: pass, `main`
- `git status --short`: pass, no output at start
- `Test-Path AGENTS.MD`: pass, `True`
- `Test-Path package.json`: pass, `True`
- `Get-Content AGENTS.MD`: pass, project rules reviewed
- `git fetch origin --tags`: pass, no output
- `git tag --list v0.1.2`: pass, `v0.1.2`
- `git rev-parse v0.1.2`: pass, `53076d90814b18ae95fae7608a4a951008fd6cdd`
- `git rev-parse v0.1.2^{}`: pass, `cef8b2fe52f98d0074ecc383385b5d0d208f5f83`
- `git show --no-patch --format=fuller v0.1.2`: pass, annotated tag `v0.1.2`, tagger date `2026-06-28 17:19:01 -0400`, message `Release v0.1.2`, peeled commit `cef8b2fe52f98d0074ecc383385b5d0d208f5f83`
- `git ls-remote --tags origin v0.1.2`: pass, remote tag object `53076d90814b18ae95fae7608a4a951008fd6cdd`
- `git log --oneline --decorate -10`: pass, current `main` HEAD `0ce665f docs: record v1.0 scope decisions`; `v0.1.2` appears at `cef8b2f`
- `git merge-base --is-ancestor cef8b2fe52f98d0074ecc383385b5d0d208f5f83 main`: pass, exit code `0`
- `git rev-parse main`: pass, `0ce665f41e50322217819b5c89776cba243bb3eb`
- `Test-Path "release\ChampCity GPT MCP Launcher-0.1.2-x64.exe"`: pass, `True`
- `Get-Item "release\ChampCity GPT MCP Launcher-0.1.2-x64.exe" | Select-Object FullName, Length, LastWriteTime`: pass, size `94309428`, LastWriteTime `2026-06-28 17:14:17` local time
- `Get-FileHash "release\ChampCity GPT MCP Launcher-0.1.2-x64.exe" -Algorithm SHA256`: pass, `93DBED3894F5025A1C20A10A75FD09E56B0CFC9ED5018BFD974905BC1F4FA907`
- `gh auth status`: pass, authenticated to `github.com` as `ChampCityChris`; CLI output showed only a masked token
- `gh release view v0.1.2 --repo ChampCityChris/ChampCity_GPT_MCP`: pass, release exists
- `gh release view v0.1.2 --repo ChampCityChris/ChampCity_GPT_MCP --json tagName,targetCommitish,name,title,body,url,assets,isDraft,isPrerelease,publishedAt,createdAt`: failed because this installed `gh` does not support JSON field `title`
- `gh release view v0.1.2 --repo ChampCityChris/ChampCity_GPT_MCP --json tagName,targetCommitish,name,body,url,assets,isDraft,isPrerelease,publishedAt,createdAt`: pass, structured release metadata collected
- `rg -n "v0\.1\.2|93dbed3894f5025a1c20a10a75fd09e56b0cfc9ed5018bfd974905bc1f4fa907|cef8b2fe52f98d0074ecc383385b5d0d208f5f83" planning docs README.md package.json`: pass, prior local evidence found
- `rg -n "Manual packaged-app smoke test|check:release|app:package|GitHub Release|Release binaries|release asset|93dbed3894f5025a1c20a10a75fd09e56b0cfc9ed5018bfd974905bc1f4fa907|cef8b2fe52f98d0074ecc383385b5d0d208f5f83" planning docs README.md package.json`: pass, prior local validation/package evidence found
- `git diff --check`: pass, no output
- `npm run check:public`: initial run failed because this report contained an unsanitized private local user path; report was corrected to use the repository's sanitized path convention
- `npm run check:public`: pass after correction, `Checked 131 source candidate files`
- `git status --short`: pass, only this untracked Builder Report was present

## Local Git Tag Status

- Local tag exists: yes
- Local annotated tag object: `53076d90814b18ae95fae7608a4a951008fd6cdd`
- Peeled commit: `cef8b2fe52f98d0074ecc383385b5d0d208f5f83`
- Expected peeled commit: `cef8b2fe52f98d0074ecc383385b5d0d208f5f83`
- Tag target matches expected commit: yes
- Tag message: `Release v0.1.2`

## Remote Git Tag Status

- Remote tag exists: yes
- Remote tag object returned by `git ls-remote`: `53076d90814b18ae95fae7608a4a951008fd6cdd`
- Remote tag object matches local annotated tag object: yes

## Main Branch State

- Current `main` HEAD: `0ce665f41e50322217819b5c89776cba243bb3eb`
- Current `main` HEAD summary: `docs: record v1.0 scope decisions`
- Release commit reachable from `main`: yes, `git merge-base --is-ancestor` returned exit code `0`
- Working tree after git checks: clean before report creation

## Local Package Artifact

- Expected local artifact: `release\ChampCity GPT MCP Launcher-0.1.2-x64.exe`
- Artifact present: yes
- Full path: `C:\Users\<you>\Projects\ChampCity_GPT\release\ChampCity GPT MCP Launcher-0.1.2-x64.exe` (sanitized)
- Size: `94309428`
- LastWriteTime: `2026-06-28 17:14:17` local time
- SHA-256: `93dbed3894f5025a1c20a10a75fd09e56b0cfc9ed5018bfd974905bc1f4fa907`
- Hash matches expected: yes
- Packaging was run: no

## GitHub Release Publication State

- GitHub CLI available and authenticated: yes
- Authenticated account: `ChampCityChris`
- GitHub Release exists: yes
- Release URL: `https://github.com/ChampCityChris/ChampCity_GPT_MCP/releases/tag/v0.1.2`
- Release name: `ChampCity GPT MCP v0.1.2`
- Tag name: `v0.1.2`
- Target commitish: `main`
- Draft: `false`
- Prerelease: `false`
- Created at: `2026-06-28T21:19:01Z`
- Published at: `2026-06-28T21:46:33Z`
- Release notes/metadata present: yes

## GitHub Release Assets

| Asset name | Size | Digest | State | Download URL |
| --- | ---: | --- | --- | --- |
| `ChampCity.GPT.MCP.Launcher-0.1.2-x64.exe` | `94309428` | `sha256:93dbed3894f5025a1c20a10a75fd09e56b0cfc9ed5018bfd974905bc1f4fa907` | `uploaded` | `https://github.com/ChampCityChris/ChampCity_GPT_MCP/releases/download/v0.1.2/ChampCity.GPT.MCP.Launcher-0.1.2-x64.exe` |

- Expected release asset attached: yes by matching version, size, and SHA-256 digest.
- Filename note: attached asset name uses dots where the local artifact name uses spaces.
- Conflicting asset found: no
- Asset uploaded or modified by this Work Card: no

## Release Evidence Completeness

- Validation commands evidence: present in prior local readiness report and GitHub Release notes.
- Package hash evidence: present in prior local readiness report and GitHub Release notes; verified again locally and in GitHub asset digest.
- Manual smoke test evidence: present in GitHub Release notes as `Manual packaged-app smoke test: pass`; prior local readiness report said manual launch smoke test was skipped at that time.
- Release tag evidence: present locally and remotely; verified by tag object and peeled commit.
- GitHub Release publication evidence: present and verified through `gh release view`.
- Attached release asset evidence: present and verified through `gh release view --json` asset metadata.

## Validation Performed

- Repository identity and AGENTS rule checks.
- Local and remote tag verification.
- Tag object and peeled commit verification.
- Release commit ancestry verification against current `main`.
- Local package artifact existence, size, timestamp, and SHA-256 verification.
- GitHub CLI authentication status check.
- GitHub Release existence, metadata, notes, and asset verification.
- Evidence search across `planning`, `docs`, `README.md`, and `package.json`.
- Report whitespace check with `git diff --check`.
- Public cleanliness check with `npm run check:public`; initial private-path failure was corrected and rerun cleanly.
- Final git status check.

## Validation Skipped And Reasons

- Packaging: skipped because this Work Card explicitly forbids packaging.
- Tag creation, movement, deletion, or push: skipped because this Work Card explicitly forbids tag mutation.
- GitHub Release creation or edits: skipped because this Work Card explicitly forbids release mutation.
- Release asset upload or replacement: skipped because this Work Card explicitly forbids asset mutation.
- Source build, full test suite, packaged app launch, and visual/manual app validation: skipped because this is a documentation-only release-state verification card.
- Markdown lint: skipped because no repo-defined Markdown lint script was present in `package.json`.

## Security And Secret Safety

- No source/app files were changed.
- No release state was mutated.
- No tag state was mutated beyond `git fetch origin --tags`.
- No assets were uploaded, replaced, deleted, or downloaded.
- `gh auth status` printed only masked token output; no unmasked secret/token/private credential was exposed or recorded.
- No OAuth store, local config, Cloudflare token, GitHub token value, `.env`, private key, release binary, or generated package output was staged or modified.

## Protected Subsystems Touched

No.

This Work Card only inspected release/git/GitHub metadata and created this Builder Report.

## Scope

- Scope changed: no
- Fallback implementation used: no
- No fallback implementation was used.

## Files Created

- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0002_v0.1.2_release_publication_baseline.md`

## Files Modified

- None besides the new Builder Report.

## Files Intentionally Not Created

- No tags.
- No GitHub Releases.
- No GitHub Release assets.
- No checksum sidecar files.
- No package/build outputs.
- No additional planning artifacts.

## Blockers Or Assumptions

- Blockers: none.
- Assumption: the GitHub Release asset with dot-separated filename is the expected release asset because its version, size, and SHA-256 digest match the expected local artifact exactly.
- Tooling note: the exact Work Card JSON command including `title` could not run because this installed `gh` does not support that JSON field; the structured read was rerun with supported fields and succeeded.

## Recommended Next Work Card

Proceed with the next v1.0 Work Card that depends on a known v0.1.2 baseline. If exact release asset filename policy matters for v1.0, add a small publication-hygiene card to decide whether future assets should preserve local filenames or use GitHub-normalized/download-safe names consistently.
