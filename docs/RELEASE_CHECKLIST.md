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
- Verify no `config/*.local.json` files are tracked.
- Verify no `logs/`, `generated/`, `release/`, `dist/`, or `node_modules/` files are tracked unless intentionally handled outside git.
- Verify README examples are generic.
- Verify first-run wizard appears on a clean machine/profile.
- Never commit release binaries.
- Upload release binaries as GitHub Release assets.
- Create tag `v0.1.0` when ready.
