# STRICT GIT & COMMIT PROTOCOL (NON-NEGOTIABLE)

1. IDENTITY & STATE VERIFICATION:
   - Local identity must be verified: `git config --local user.name "dkayush7373"` and `git config --local user.email "dkayush73@gmail.com"`.
   - Never use global config. Verify source is `file:.git/config`.

2. QUALITY GATES BEFORE EVERY COMMIT:
   - Run quality gates (`npm run lint`, `npx tsc --noEmit`, `npm test` as configured) before staging.
   - All checks must pass with 0 errors. Never commit broken code.

3. COMMIT AFTER EVERY SINGLE LOGICAL STEP:
   - Absolutely NO mega-commits, delayed commits, or batching at session end.
   - Commit as you build: 1 commit per distinct step (e.g., Step 1: styles/tokens, Step 2: component UI, Step 3: logic/hook, Step 4: tests, Step 5: docs).
   - Conventional Commits format: `type(scope): description`.
   - Explicit staging only (`git add <exact-file>`). Never run `git add .`.

4. DIRECT MAIN DELIVERY (GITHUB CONTRIBUTION INTEGRITY):
   - Push all commits directly to `origin main` (or fast-forward merge without squash) so every individual commit registers on the GitHub profile contribution graph.
   - Submodule changes: commit and push pointer updates to `travel-resque-repo` on `main`.
   - Strictly forbidden: `git commit --amend`, squash, `rebase`, `reset --hard`, force-push.

5. VERIFICATION & REAL EVIDENCE:
   - For every commit, verify remotely with `git ls-remote origin main`.
   - Output real terminal proof for each step: full 40-char SHA, commit message, and clickable GitHub URL:
     `https://github.com/dkayush7373/<repo>/commit/<SHA>`
