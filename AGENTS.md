# STRICT GIT & COMMIT PROTOCOL (NON-NEGOTIABLE)

1. IDENTITY & STATE VERIFICATION:
   - Verify local identity: `git config --local user.name "dkayush7373"` and `git config --local user.email "dkayush73@gmail.com"`.
   - Never use global config. Verify source is `file:.git/config`.

2. QUALITY GATES BEFORE EVERY COMMIT:
   - Run `npm run lint`, `npx tsc --noEmit`, and `npm test` (as applicable to the project) before staging.
   - All checks must pass with 0 errors. Never commit broken code.

3. COMMIT AFTER EVERY SINGLE LOGICAL STEP:
   - Absolutely NO mega-commits, delayed commits, or batching the whole session at the end.
   - Commit as you build: 1 commit per distinct step (e.g., Step 1: styles/tokens, Step 2: component UI, Step 3: logic/hook, Step 4: tests, Step 5: docs).
   - Use Conventional Commits: `type(scope): description` (`feat:`, `style:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).
   - Explicit staging only (`git add <exact-file>`). Never run blind `git add .`.

4. DIRECT MAIN DELIVERY (GITHUB CONTRIBUTION INTEGRITY):
   - Deliver and push all commits directly to `origin main` (or fast-forward merge without squashing) so every individual commit registers immediately on the GitHub profile contribution graph.
   - If submodule changes occur, commit and push the updated pointer to `travel-resque-repo` on `main` as well.
   - Strictly forbidden: Never use `git commit --amend`, squash, `rebase`, `reset --hard`, or force-push.

5. VERIFICATION & REAL EVIDENCE:
   - For every commit, verify remotely with `git ls-remote origin main`.
   - Output real terminal proof for each step: full 40-char SHA, commit message, and clickable GitHub URL:
     `https://github.com/dkayush7373/<repo>/commit/<SHA>`
