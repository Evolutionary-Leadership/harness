# In-flight features

One file per in-flight feature, named by its feature slug, holding what that
branch declares it is going to touch: paths always, and specification node
slugs where the project has connected a specification. So a parallel feature
sees a collision before the merge rather than at it.

**A declaration, not a mirror of the diff.** What a branch has already
changed is derivable from GitHub, and this branch never keeps a second copy
of something GitHub owns. What a branch is *about to* touch exists nowhere
else, and it is the only half a branch that has pushed nothing can offer.

## The record

    ---
    slug: add-webhooks
    branch: feature/add-webhooks
    key: MYPR-7
    author: someone@example.com
    declared_at: 2026-01-01T09:00:00Z
    updated_at: 2026-01-01T11:30:00Z
    spec: my-product
    paths:
      - src/webhooks/**
    nodes:
      - http-api
    ---

`key` and `nodes` appear only where the project names a specification
product. `spec: none` says there is none, so a missing node list is always a
declaration and never an omission.

## Who writes it, and when

`/feature` phase 0 declares it, every feature-context refresh refreshes it,
and `/to-preprod` deletes it when the branch merges: after that the code is
on `preprod` and GitHub owns it.

One file per slug means one writer per file, so no reservation and no
locking is needed here. Only `claims/` needs compare-and-swap.

A record whose `feature/<slug>` branch is gone from the remote has no writer
left, so the next reader sweeps it. That is the same test `claims/adr` uses
before it releases a number.

## What a collision does

It is reported to whoever is running the session. It stops nothing:
everything on this branch is advisory.
