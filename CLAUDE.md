Use `npm run typecheck` for type checking.

Check [./CONTEXT.md](./CONTEXT.md) for terminology questions.

For user-facing changes, add a changeset to `.changeset`. Check all changesets there first to see if there are duplicates. We use `@changesets/cli`, but you can create/edit the file manually. Make all changesets `patch` (since we're pre-1.0). Use `package.json#name` for the name.

When changing public-facing behavior, check `README.md` to see if the documentation needs updating.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `mattpocock/sandcastle`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels. Agent provider support is detailed here. See `docs/agents/triage.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Local packaging note

This checkout carries a custom Codex auth-rotation patch on branch `codex-auth-rotation`. For a distributable tarball, install the optional Daytona peer dep first, then build and pack locally:

- `npm install -D @daytona/sdk`
- `npm run build`
- `NPM_CONFIG_CACHE=/tmp/.npm-cache HUSKY=0 npm pack --ignore-scripts`

The resulting tarball is `ai-hero-sandcastle-0.5.9.tgz`. This custom build enables `codex(..., { authRotation: { enabled: true } })`, which snapshots one host `~/.codex/auth-*.json` identity per sandbox run instead of sharing a single mutable host `auth.json`.
