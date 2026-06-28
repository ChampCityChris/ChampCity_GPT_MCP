# GitHub Publication Checklist

- Create the public GitHub repository.
- Confirm the remote URL.
- Confirm the branch name.
- Confirm no secrets are tracked.
- Confirm no private paths are tracked.
- Confirm no local artifacts are tracked.
- Confirm packaged-runtime docs say Node.js/npm are build-from-source requirements only.
- Confirm release assets are generated from the in-process Electron server runtime, not a hardcoded local source path.
- Confirm `config/figma.local.json` is not tracked or staged.
- Confirm generated Figma handoffs do not contain private screenshots/metadata that should stay out of the public repo.
- Confirm no real `figmaAccessToken` or Figma token-looking strings appear in docs, examples, generated notes, or committed source.
- Work on `dev` or a feature branch until the repository is ready.
- Run `get_commit_readiness`, `safe_stage_changes`, `pre_commit_safety_scan`, and `commit_validated_changes` before pushing MCP-assisted changes.
- Push with `push_current_branch` only after reviewing the local commit result.
- Do not force push through MCP tooling. The MCP push tool does not expose force flags.
- Do not push `main` through MCP tooling unless `allowMainPush` is explicitly intended.
- Push the initial public branch.
- Create the first GitHub release only after Pass 2 if release artifacts are ready.
- Upload release binaries as release assets, not committed files.

Optional GitHub CLI command:

```powershell
gh repo create <owner>/<repo> --public --source . --remote origin --push
```

Without GitHub CLI:

```powershell
git remote add origin https://github.com/<owner>/<repo>.git
git branch -M main
git push -u origin main
```
