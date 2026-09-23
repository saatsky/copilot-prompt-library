---
title: Use a local folder of Markdown files as the prompt source of truth
status: accepted
date: 2026-09-23
---

# 0001. Use a local folder of Markdown files as the prompt source of truth

## Context

The Prompt Library must make reusable prompts available from a Copilot canvas
without taking ownership of the user's existing file-management workflow.
Prompts may already live in a Git repository, a synced folder, or an ordinary
local directory. The canvas needs to read and write prompt content, remember
which folder the user selected, and detect changes made outside the canvas.
Git operations, repository/session ownership, and a proprietary storage format
would couple the library to one collaboration workflow and make the same
prompts harder to use elsewhere.

## Decision

Use a user-selected local folder of Markdown files as the canonical source of
prompt content. Persist only the selected root path in the user's local
Copilot configuration, and perform ordinary filesystem reads and writes below
that root. Treat Git, cloud synchronization, backup, and editor workflows as
external concerns: the extension must not invoke Git or inspect repository
metadata.

All reads and writes resolve paths strictly inside the configured root.
Discovery recursively scans Markdown files while skipping hidden,
dependency/VCS, and symlinked entries. External changes are surfaced through
refresh/metadata checks and saves use optimistic conflict detection rather than
silently overwriting a newer file.

## Considered options

### Store prompts in extension or session state

Rejected. State tied to an extension installation, repository, or Copilot
session would make prompts less portable and would hide them from normal
editors, Git, and synchronization tools.

### Use a database or proprietary prompt archive

Rejected. A database would add a persistence and migration boundary while
making review, backup, and reuse outside the canvas less transparent.

### Make the extension a Git client

Rejected. Git is valuable for users who choose it, but requiring the extension
to own commits, branches, remotes, or synchronization would add scope and
conflict with other folder synchronization tools.

## Consequences

Positive:

- Prompts remain inspectable, editable, reviewable, and synchronizable with
  ordinary filesystem and Git tooling.
- One configured folder can be reused across Copilot sessions and repositories.
- External edits can be detected without the canvas becoming the only editor.
- Containment checks and conflict detection make the file boundary explicit.

Negative:

- The user must provide a path; the current canvas host does not provide a
  native folder picker.
- Filesystem permissions, sync conflicts, and Git merge conflicts remain
  outside the extension's control.
- The canvas needs refresh/change detection instead of assuming it owns all
  updates.

## References

- [Project README: What this is (and isn't)](../../README.md#what-this-is-and-isnt)
- [Project README: Local-folder behavior](../../README.md#local-folder-behavior)
- [`server/config-store.mjs`](../../server/config-store.mjs)
- [`server/prompt-repo.mjs`](../../server/prompt-repo.mjs)

## Related decisions

- [0002. Use metadata-driven discovery in a flat collection](0002-metadata-driven-discovery.md)
- [0004. Use a user-scoped canvas and explicit clipboard handoff](0004-user-scoped-canvas-and-clipboard-handoff.md)

