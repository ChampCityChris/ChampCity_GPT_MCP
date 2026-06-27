# GitHub Publication Checklist

- Create the public GitHub repository.
- Confirm the remote URL.
- Confirm the branch name.
- Confirm no secrets are tracked.
- Confirm no private paths are tracked.
- Confirm no local artifacts are tracked.
- Push the initial commit.
- Create the first GitHub release only after Pass 2 if release artifacts are ready.

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
