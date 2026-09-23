---
title: Use a user-scoped canvas and explicit clipboard handoff
status: accepted
date: 2026-09-23
---

# 0004. Use a user-scoped canvas and explicit clipboard handoff

## Context

The Prompt Library is useful across repositories and Copilot sessions because
its source of truth is a user-selected folder. The extension therefore needs
to be installed once for the user rather than copied into each project.

The current Copilot canvas SDK exposes an experimental canvas surface and
extension actions, but this implementation does not have a documented safe API
to prefill the Copilot composer or submit a message. Automatically submitting
prompt text would also remove a useful user review and editing boundary.
The canvas can request clipboard access, so an explicit copy operation can
bridge the library and composer while retaining user control.

## Decision

Implement one `prompt-library` canvas extension intended for user-scoped
installation. Store the folder preference under the user's home directory,
serve each open canvas instance locally, and expose read-only
`search_prompts` and `get_prompt` actions for agents that need prompt data
in-conversation.

For interactive reuse, copy only the selected Markdown prompt body to the
clipboard and require the user to paste, review, and submit it in the
composer. Do not attempt direct composer insertion, automatic submission,
skill loading, or agent switching. Surface clipboard permission failures
explicitly.

## Considered options

### Install per repository or session

Rejected. That would make a user-wide prompt collection dependent on the
current checkout and would duplicate configuration and installation work.

### Insert directly into or auto-submit the composer

Rejected. The current canvas SDK does not expose a safe supported mechanism
for this, and auto-submit would bypass user review and create surprising
side effects.

### Copy the full file, including front matter

Rejected for the primary interaction. The reusable instruction body is what
belongs in a conversation; metadata is for discovery and maintenance. The
agent-callable `get_prompt` action remains available when metadata and body are
both needed.

### Provide only agent actions and no canvas

Rejected. Agents can search and fetch, but users still need a visual way to
browse, preview, edit, and copy prompts.

## Consequences

Positive:

- The same canvas and folder preference are available across user sessions.
- Copying is explicit, reversible, and reviewable before submission.
- Agent actions support in-conversation use without requiring clipboard access.
- The extension avoids undocumented composer integration and hidden runtime
  orchestration.

Negative:

- Reuse requires a paste step and cannot be a one-click composer insertion.
- Clipboard permissions depend on the canvas host and can fail visibly.
- Canvas SDK changes may require maintenance because the surface is
  experimental.
- User-scoped installation means the extension's availability is not a
  repository-local guarantee.

## References

- [Project README: Installation (user-scoped)](../../README.md#installation-user-scoped)
- [Project README: Using it](../../README.md#using-it)
- [Project README: Agent-callable actions](../../README.md#agent-callable-actions)
- [Project README: Known limitations](../../README.md#known-limitations)
- [`extension.mjs`](../../extension.mjs)
- [`server/config-store.mjs`](../../server/config-store.mjs)
- [`web/app.js`](../../web/app.js)

## Related decisions

- [0001. Use a local folder of Markdown files as the prompt source of truth](0001-local-folder-markdown-source-of-truth.md)
- [0003. Use an interoperable Markdown metadata superset](0003-interoperable-markdown-metadata.md)

