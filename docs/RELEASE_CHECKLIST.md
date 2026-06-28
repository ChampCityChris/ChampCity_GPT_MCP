# Release Checklist

Run these checks before tagging or attaching release assets:

- `npm run build`
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm audit --audit-level=low`
- `npm run check:public`
- `npm run app:dist`
- `npm run check:release`
- For MCP-assisted commits, run `get_commit_readiness`, `safe_stage_changes`, `pre_commit_safety_scan`, and `commit_validated_changes` on `dev` or a feature branch.
- Push with `push_current_branch` only after reviewing the local commit result.
- Verify no `config/*.local.json` files are tracked.
- Verify `config/figma.example.json` contains only `<FIGMA_ACCESS_TOKEN>` and no real token.
- Verify generated Figma handoff packages are intentionally included or excluded based on whether the source design is public.
- Verify no real `figmaAccessToken` or Figma token-looking strings are present in release-bound files.
- Verify no `logs/`, `generated/`, `release/`, `dist/`, or `node_modules/` files are tracked unless intentionally handled outside git.
- Verify README examples are generic.
- Verify first-run wizard appears on a clean machine/profile.
- Verify packaged runtime starts the HTTP MCP server in-process and does not require Node.js/npm.
- Verify packaged runtime does not spawn the launcher executable, `node.exe`, or `dist/src/index.js` for the normal `Start Local HTTP MCP Server` button.
- Verify installed mode stores config/logs/generated files under Electron `userData`.
- Verify portable mode stores config/logs/generated files under `data\` beside the executable when present.
- Never commit release binaries.
- Upload release binaries as GitHub Release assets.
- Keep releases separate from commits; do not create GitHub releases from the git workflow tools.
- Create tag `v0.1.2` when ready.
