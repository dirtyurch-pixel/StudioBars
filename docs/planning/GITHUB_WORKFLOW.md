# GitHub workflow — mandatory once development is authorised

**Not authorised now:** No repo creation, remote connections or push while in planning mode.

## Phase 0 prerequisites
- Product owner approves exact GitHub account/repo name and private visibility.
- Decide whether to create a new private repo or connect an existing one.
- Confirm Git/GitHub authentication with least permissions needed.
- Add `.gitignore` before the first commit and review the staged files.

## Never commit
API keys, `.env` secrets, credentials/tokens, personal lyrics, private song databases, imported audio, recorded vocals, large third-party datasets without rights, local file paths or machine-specific secrets. Use example config (`.env.example`) without real values. Check third-party licences and attribution.

## Each expressly authorised stage
1. Create/use a dedicated stage branch (example `phase-1-editor`).
2. Implement **only the approved stage**.
3. Run and record real acceptance tests; do not fake results.
4. Review staged diff and check for credentials/private audio/lyrics.
5. Commit with clear message and exact scope.
6. Push to the approved private repository, verify the remote ref/commit.
7. If appropriate, open a PR; **do not merge to main automatically**.
8. Report: stage, changes, test commands/results, branch, full commit SHA, push verification, CI status, blockers and owner manual checks.
9. STOP. Do not automatically start next phase.

If push fails, report **PUSH BLOCKED**, preserve local changes and wait. Never claim a successful push without confirmation. No force pushes or destructive remote operations without separate permission.

**Note:** GitHub stage history is NOT a backup of private lyrics/audio; plan separate encrypted local backups.
