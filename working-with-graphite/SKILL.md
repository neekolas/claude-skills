---
name: working-with-graphite
description: Use when managing Git branches and PRs with the Graphite CLI (gt). Covers creating stacked PRs, modifying mid-stack, submitting, syncing, and resolving conflicts.
user-invocable: true
allowed-tools: Bash(gt *), Read, Grep, Glob
argument-hint: "[action] e.g. create, modify, submit, sync, restack"
---

# Working with Graphite

## Core Principles

1. **Never commit to main** All commits must be on a feature branch
2. **Do not create branches unless asked** Do not create new branches unless explicitly requested to.
3. **Never use raw Git rebase** -- always use `gt` commands to preserve stack metadata
4. Always set Claude as the co-author when committing

## Committing code

- Manually stage changes to impacted files using git commands. Do not use the `-a` flag to automatically stage all changes.
- For new features, create a commit using `gt modify --commit -m "description of the change"`
- For modifications to an existing feature or bug fixes, amend the commit using `gt modify`

## Submitting Changes

- When the task is complete, always `gt restack` and ensure that any impacted upstack branches are still valid (lint checks pass)
- Use `gt submit --stack --update-only` when tasks are complete
- Only submit a new branch with the user's explicit consent.
- New branches are always initially submitted as a draft

## Handling Conflicts

When conflicts occur during `gt sync`, `gt restack`, or `gt modify`:

1. Resolve conflicts in affected files
2. Stage resolved files: `git add <files>`
3. Continue: `gt continue` or `gt continue --all`

## Workflow: Updating a Mid-Stack Branch

1. `gt checkout <target-branch>`
2. Make edits
3. `gt modify -a` (amends and restacks upstack)
4. `gt submit --stack --update-only --no-interactive` (pushes all updated branches)

## Common Gotchas

- **Never `git rebase -i`** -- breaks Graphite metadata. Use `gt move` instead.
- **Never `git branch -d`** -- use `gt delete` to preserve metadata.
- **Never `git commit --amend`** -- use `gt modify -a` which also restacks.
- **`gt rename` breaks PR links** -- avoid renaming branches with existing PRs.
- **Squash merges cause cascading conflicts** -- `gt sync` + `gt restack` resolves this.
