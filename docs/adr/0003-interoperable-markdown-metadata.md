---
title: Use an interoperable Markdown metadata superset
status: accepted
date: 2026-09-23
---

# 0003. Use an interoperable Markdown metadata superset

## Context

The source of truth is intended to remain useful outside the Prompt Library.
Markdown with front matter is readable in editors and can be committed or
synced without conversion. At the same time, the library needs stable identity,
search metadata, lifecycle, and version fields, and should leave room for
interoperability with MCP prompt concepts.

VS Code custom prompt files use `.prompt.md` and may contain fields such as
`description`, `mode`, `model`, `tools`, and `argument-hint`. Skills and agents
are different runtime concepts from reusable prompt text; treating their names
as executable instructions would cause the library to take over orchestration.

## Decision

Use a deliberately small, flat YAML front-matter subset in Markdown. The
library's metadata includes `name`, `title`, `description`, `tags`, advisory
`skills` and `agent` fields, `status`, `version`, and `replaced-by`.
`description` intentionally aligns with VS Code `.prompt.md`; unknown
front-matter keys are preserved by value so compatible files can be edited
without losing tool-specific metadata.

Accept existing `.md` and `.prompt.md` files without requiring conversion.
Normalize missing or invalid library fields with visible warnings and
filename-derived fallbacks where appropriate. Treat `skills` and `agent` as
display-only references: the extension does not load skills, switch agents,
interpret MCP arguments, or otherwise execute metadata.

Keep the internal prompt shape and stable name compatible with a future
optional adapter for MCP `prompts/list` and `prompts/get`, without claiming
that an MCP server exists in this solution.

## Considered options

### Define a proprietary prompt format

Rejected. A proprietary format would make import/export and editor use
needlessly expensive and would contradict the local Markdown source-of-truth
decision.

### Require one ecosystem's schema exactly

Rejected. Requiring only the library schema would reject useful VS Code files;
requiring only VS Code or MCP fields would omit lifecycle and collection
metadata needed by this canvas.

### Treat skill and agent metadata as executable

Rejected. Loading skills or switching agents would create hidden side effects
and blur separate concepts. Selection and orchestration remain explicit user
or agent actions.

## Consequences

Positive:

- Prompt files remain portable across the canvas, editors, Git, and sync tools.
- `.prompt.md` files can be read as-is and unknown metadata survives edits.
- The schema has a clear path toward MCP interoperability without coupling the
  MVP to an unimplemented server.
- Prompt, skill, and agent responsibilities remain explicit.

Negative:

- The parser supports only the documented flat YAML subset; nested maps,
  block scalars, anchors, and other YAML features are out of scope.
- Canonical serialization preserves values but not every original formatting
  choice.
- Future MCP argument support would require a deliberate adapter rather than
  being implied by current metadata.

## References

- [Project README: Prompt vs. skill vs. agent](../../README.md#prompt-vs-skill-vs-agent)
- [Project README: VS Code `.prompt.md` compatibility](../../README.md#vs-code-prompt-md-compatibility)
- [Project README: Future MCP compatibility](../../README.md#future-mcp-compatibility-not-implemented-yet)
- [Project README: Front-matter format and limitations](../../README.md#front-matter-format-and-limitations)
- [`server/frontmatter.mjs`](../../server/frontmatter.mjs)
- [`server/validate.mjs`](../../server/validate.mjs)

## Related decisions

- [0002. Use metadata-driven discovery in a flat prompt collection](0002-metadata-driven-discovery.md)

