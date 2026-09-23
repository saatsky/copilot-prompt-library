---
title: Use metadata-driven discovery in a flat prompt collection
status: accepted
date: 2026-09-23
---

# 0002. Use metadata-driven discovery in a flat prompt collection

## Context

Prompt files can be shared across teams, editors, and synchronization
mechanisms. A directory hierarchy is useful for personal organization, but it
is not a stable discovery contract: users may reorganize folders, combine
libraries, or import files from another tool. The canvas therefore needs
search and filtering that remain meaningful when paths change.

The implementation already has a flat prompt record shape with a relative path,
normalized metadata, and body. Users need human-readable titles and free-form
tags for discovery, while maintainers need lifecycle and version information
to distinguish current prompts from drafts, superseded prompts, and historical
ones.

## Decision

Discover all eligible Markdown files recursively, but treat front-matter
metadata—not directory names—as the discovery and filtering contract. Require
`name` and `title` for prompts created by the canvas, use a filename-derived
fallback title for imported files, and support searchable `description` and
free-form `tags`.

Represent lifecycle with `draft`, `active`, `deprecated`, and `archived`
statuses. Default searches and the UI to `active`, while allowing callers to
request other statuses explicitly. Store a SemVer `version` and allow
`replaced-by` to link a deprecated prompt to its successor by stable `name`.
Keep the relative path for addressing the file, not for classifying its
meaning.

## Considered options

### Make directory taxonomy the primary organization

Rejected. Folder names would become a hidden schema and would make moving or
merging prompt collections change their meaning. It would also make imported
and `.prompt.md` files harder to classify consistently.

### Use only full-text search

Rejected. Full-text search is useful for finding wording, but it cannot
reliably express lifecycle visibility, tag intersections, or successor
relationships.

### Use a centrally managed registry or index

Rejected for this solution. A generated index would introduce another
artifact that can drift from Markdown files and would make external file
changes harder to observe. The current scale is served by scanning and
filtering loaded prompt records.

## Consequences

Positive:

- Moving a file does not change its semantic classification.
- Search can combine text, tags, tag match mode, and lifecycle status.
- Stable names support replacement links independently of filenames.
- Lifecycle and version metadata make maintenance visible without hiding
  older files from the collection.

Negative:

- Metadata quality affects discovery; malformed or missing fields produce
  warnings and inferred values rather than silently fixing files.
- Recursive scans have bounded depth and file-count limits and may need
  refreshes after external changes.
- A flat semantic collection does not remove the option for users to use
  subfolders for personal organization.

## References

- [Project README: Metadata schema](../../README.md#metadata-schema)
- [Project README: Lifecycle](../../README.md#lifecycle)
- [Project README: Versioning](../../README.md#versioning)
- [`server/search.mjs`](../../server/search.mjs)
- [`server/prompt-repo.mjs`](../../server/prompt-repo.mjs)
- [`server/validate.mjs`](../../server/validate.mjs)

## Related decisions

- [0001. Use a local folder of Markdown files as the prompt source of truth](0001-local-folder-markdown-source-of-truth.md)
- [0003. Use an interoperable Markdown metadata superset](0003-interoperable-markdown-metadata.md)

