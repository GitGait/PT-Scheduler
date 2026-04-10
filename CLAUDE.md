# PT Scheduler - Project Context

Home health physical therapy scheduling PWA. Built and running. Currently in active UI/UX polish phase.

## Deploy Rule
**Always deploy after completing changes.** Full sequence:
```bash
cd pt-scheduler
npm run build                          # 1. Verify build
cd ..
git add -A && git commit -m "message"  # 2. Commit
git push origin main                   # 3. Push to GitHub
cd pt-scheduler && vercel --prod       # 4. Deploy to Vercel
```
Do all four steps. Don't skip any. If build fails, fix it before committing.

## Do NOT
- Use `any` types or leave unused variables.
- Add more code to `SchedulePage.tsx` — it's the largest file. Extract new features into separate components.
- Access Dexie directly — use `src/db/operations.ts` helpers.
- Create new files or restructure without asking — extend existing files when possible.
- Create new stores when an existing store can be extended.
- Call real Google APIs in tests — always mock.
- Skip `npm run build` verification after non-trivial changes.
- Stack multiple changes without verifying the build.

## Working Rules
- **Check existing code first.** Before creating a new file or utility, check `src/utils/`, `src/components/ui/`, or `src/api/`. Extend existing code over creating duplicates.
- **Verify after changes.** Run `npm run build` after any non-trivial edit to catch errors early.

## Context Rules
- **Don't bulk-read docs.** The `phases/` specs are reference only — read specific sections when needed, not entire files.
- **Detailed rules live in `.claude/rules/`.** Check `architecture.md`, `code-style.md`, and `testing.md` for full conventions — don't duplicate them here.
