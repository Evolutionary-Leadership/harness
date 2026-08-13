> Generated from `evolutionary-leadership/harness-forge@10f34f1`. Do not edit here. Edit in the source repo.

# Harness

**A turnkey, AI-native development workflow for Claude Code + GitHub.**

This template gives a fresh repository a complete, convention-driven
CI/CD harness: ephemeral `claude/` session branches that collapse into
persistent `feature/` branches, auto-merged PRs to `dev`, versioned
releases to `main`, and a catalog of Claude Code skills that drive the
whole lifecycle in natural language. Optionally, it deploys every
feature branch to its own isolated Railway preview environment.

## Start here (three steps)

1. **Click "Use this template"** and create your repository. Make sure
   `dev` is the default branch (it is, unless you changed it).
2. **Open the new repository in Claude Code.**
3. **Run `/setup`.** It asks at most two questions (deploy to Railway?
   start from the standard technical foundation?), configures the
   repository, pushes one commit, and deletes itself. That is the whole
   installation.

After `/setup` finishes, start a fresh chat and describe your first
feature. If you staged the technical foundation, run `/foundation` in
that fresh chat first.

## What `/setup` decides

- **Railway or code-only.** Answer yes and the harness activates its
  Railway machinery: one-time provisioning of production and dev
  environments (app service, Postgres, object-storage bucket), plus an
  isolated preview environment per feature branch. Answer no and you
  get the code-only variant: the full branch-and-release flow with no
  deploy target.
- **The technical foundation (Railway projects only).** Answer yes and
  `/setup` stages a one-shot `/foundation` skill that builds the
  standard stack (Next.js 16, Drizzle, Better Auth, TanStack Query,
  optimistic UI) in place of the minimal Express starter.

Until `/setup` runs, the unconfigured Railway machinery lives inert
under `.claude/setup/`. Nothing in there can trigger or fail; `/setup`
either activates it or deletes it.

## The workflow you end up with

```
claude/<name>-<sessionId>   Claude Code works here
        |
        v   GitHub Actions, driven by the branch name alone
feature/<name>              persistent feature branch (+ preview env on Railway setups)
        |
        v   /mergedev
dev                         PR auto-created and auto-merged
        |
        v   /release
main                        versioned, tagged, released
```

Run `/getting-started` in any session to see the full skill catalog.
`.claude/HARNESS.md` documents every harness-managed file, and
`claude-md-snippet.md` is the starting point for your own `CLAUDE.md`.

## Upgrading later

The harness is authored in
[`evolutionary-leadership/harness-forge`](https://github.com/Evolutionary-Leadership/harness-forge)
and synced into this template repo on every release. Established
projects pull newer harness versions with `/harness-upgrade`; your
variant is recorded in `.harness-version` by `/setup`.

## License

Apache 2.0. See `LICENSE` and `NOTICE`.
