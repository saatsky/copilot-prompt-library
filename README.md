# Prompt Library

A **local-first Prompt Library canvas** for the GitHub Copilot App / Copilot CLI.
It lets you browse, search, preview, create, and edit reusable Markdown
prompts that live in a folder **you** choose on disk — no Git, no special
directory layout, no proprietary format.

> **Canvas SDK status:** canvas support in `@github/copilot-sdk` is an
> **experimental** wire-protocol surface (see `canvas.d.ts`) and may change in
> future CLI/SDK releases. This extension is built against that experimental
> API and may need updates if the surface changes.

---

## What this is (and isn't)

- **Is:** a folder-backed, metadata-driven library of Markdown prompt files,
  browsable from a canvas panel inside any Copilot session.
- **Is not:** a Git client. The extension never runs Git commands, never
  reads `.git`, and has no concept of branches, commits, or remotes. Your
  prompt folder is free to *also* be a Git repo, a synced OneDrive/Dropbox
  folder, or a plain folder — this extension only ever does plain file I/O
  against the path you configure.
- **Is not:** directory-taxonomy driven. You can organize files into
  subfolders however you like for your own sanity, but discovery, search,
  and filtering are entirely based on front-matter metadata, not path
  structure.

## Prompt vs. skill vs. agent

These three concepts are easy to blur together; this extension keeps them
distinct on purpose:

| Concept    | What it is                                                                 | How this extension treats it |
|------------|------------------------------------------------------------------------------|-------------------------------|
| **Prompt** | A reusable block of instruction text (a Markdown file) you want to reuse or paste into a conversation. | The thing this extension manages: discovers, searches, previews, edits. |
| **Skill**  | A packaged, invokable capability (like the `skill` tool in this CLI) that an agent can load to gain domain-specific instructions/behavior. | Referenced *by name only* in a prompt's optional `skills` front-matter field, as a hint. **Never auto-loaded** by this extension. |
| **Agent**  | A configured persona/tool-loadout that runs a session or sub-task. | Referenced *by name only* in a prompt's optional `agent` field, as an advisory suggestion for which agent might best execute this prompt. |

A prompt's `skills`/`agent` fields are pure metadata — display-only hints for
a human (or a coordinating agent) deciding what to do with the prompt. This
extension does not invoke skills or switch agents on your behalf.

## Metadata schema

Front matter is plain YAML (a safe subset — see [Front-matter format](#front-matter-format-and-limitations)
below). All fields are optional on files you didn't create with this tool;
missing/invalid fields produce **visible warnings**, never silent exclusion.

| Field         | Type              | Required for **new** prompts | Notes |
|---------------|-------------------|:---:|-------|
| `name`        | string            | ✅ | Stable machine identifier. Recommended pattern: `^[a-z0-9][a-z0-9._-]*$`. Used for `replaced-by` links and future MCP-style lookup by name. |
| `title`       | string            | ✅ | Human-readable display/search title. |
| `description` | string            | – | Short one-line summary. Also the field VS Code `.prompt.md` files call `description`. |
| `tags`        | list of strings   | – | Freely chosen; searchable and filterable. |
| `skills`      | list of strings   | – | Advisory only — see [Prompt vs. skill vs. agent](#prompt-vs-skill-vs-agent). Never auto-loaded. |
| `agent`       | string            | – | Advisory preferred agent name. Never auto-switches your session. |
| `status`      | enum              | ✅ (defaults to `active`) | One of `draft`, `active`, `deprecated`, `archived`. See [Lifecycle](#lifecycle). |
| `version`     | semver string     | ✅ (defaults to `1.0.0`) | e.g. `1.2.0`. See [Versioning](#versioning). |
| `replaced-by` | string            | – | Name (`name` field, not filename) of the prompt that replaces a `deprecated` one. |

Any other front-matter keys (e.g. VS Code's `mode`, `model`, `tools`,
`argument-hint`) are preserved untouched — see [VS Code compatibility](#vs-code-prompt-md-compatibility).

### Lifecycle

```
draft ──────► active ──────► deprecated ──────► archived
```

- **`draft`** — work in progress; hidden from the default view.
- **`active`** — the default, ready-to-use state. **This is the only status
  shown by default**; the UI has explicit checkboxes to also show draft,
  deprecated, or archived prompts.
- **`deprecated`** — still usable but superseded; pair with `replaced-by` to
  point at its successor. The UI shows a deprecation banner with a link to
  the replacement (resolved by `name`, if present in the same folder).
- **`archived`** — retired; kept for reference/history only.

### Versioning

`version` is a plain [SemVer](https://semver.org/) string (`MAJOR.MINOR.PATCH`,
optional pre-release/build metadata). Suggested convention for prompts:

- **PATCH** (`1.0.0` → `1.0.1`): wording/typo tweaks that don't change intent.
- **MINOR** (`1.0.0` → `1.1.0`): added guidance, new optional sections,
  backward-compatible improvements.
- **MAJOR** (`1.0.0` → `2.0.0`): a meaningfully different prompt — usually
  paired with deprecating the old one and setting `replaced-by`, as in the
  bundled `legacy-summary-prompt.md` → `modern-summary-prompt` example.

## Local-folder behavior

- You choose an absolute folder path on first use (or via **Change
  folder…**). It's persisted to `~/.copilot/prompt-library/config.json` (a
  small local JSON preference file, independent of any single repository or
  session). The selected theme is persisted there too.
- Every file read/write is checked to resolve **strictly inside** that
  folder (no `..` traversal, no absolute-path escapes, symlinks are not
  followed) before touching disk.
- Discovery recursively scans the folder for `*.md` files (which includes
  `*.prompt.md`), skipping hidden directories (`.git`, `.hidden`, etc.) and
  symlinks.
- **Refresh**: click **Refresh** any time to re-scan. The canvas also polls
  lightweight file-metadata every few seconds and shows a banner when files
  changed outside the canvas (e.g. edited in your own editor, or pulled via
  Git), without silently reloading over any unsaved edit you're mid-way
  through in the canvas.
- **Conflict detection**: saving an edit records the file's last-known
  modified time; if the file changed on disk since you loaded it, the save
  is rejected with an explicit conflict error instead of overwriting.

## VS Code `.prompt.md` compatibility

Existing VS Code custom prompt files (`*.prompt.md`, with front matter like
`description`, `mode`, `model`, `tools`, `argument-hint`) are read **as-is** —
no conversion step. Fields this schema doesn't know about are shown in the
UI as "preserved extra fields" and are written back byte-for-byte in value
(though front matter is re-serialized as canonical YAML, not necessarily
identical formatting — see the note below) whenever the file is edited
through this canvas. See `examples/refactor-for-readability.prompt.md` for a
worked example: it has no `name`/`title` (not required on existing files),
so the UI derives a fallback title from the filename and shows a warning,
while `mode`, `model`, `tools`, and `argument-hint` all survive untouched.

## Future MCP compatibility (not implemented yet)

The internal prompt shape (`name`, `title`, `description`, body, and the
metadata needed to eventually support MCP-style prompt arguments) is kept
compatible with a future, optional adapter exposing prompts over
[MCP's `prompts/list` / `prompts/get`](https://modelcontextprotocol.io/) —
but **no MCP server is implemented in this MVP**. Skills and prompts remain
distinct concepts even if such an adapter is added later.

## Front-matter format and limitations

Front matter is parsed with a small, dependency-free parser (`server/frontmatter.mjs`)
that supports the flat subset of YAML actually used by prompt files: string,
boolean, and number scalars, plus single-level lists (`tags:\n  - a\n  - b`
or `tags: [a, b]`). It intentionally does **not** support nested maps,
anchors/aliases, multi-document streams, or block scalars (`|`, `>`). This
keeps the extension free of third-party dependencies. On save, unknown
fields are preserved by value, but the whole front-matter block is
re-serialized in a canonical form (known fields first, in a fixed order,
then other fields in their original order) — so exact original formatting
(comment placement, quote style, key order) is not guaranteed to survive a
round trip, but no data is lost.

## Installation (user-scoped)

This extension is designed to be installed **once, per user**, and then be
available in every Copilot CLI/App session — it is not tied to any one
repository or the `saatsky-po` custom agent.

Using the `install_extension` tool (or the equivalent CLI flow) pointed at
this repository:

```
install_extension({
  url: "https://github.com/saatsky/copilot-prompt-library/tree/main/",
  scope: "user"
})
```

This copies the repository's extension files into your personal extensions
directory (independent of any single project/session) and reloads
extensions so the **Prompt Library** canvas becomes available immediately.

Alternatively, for local development, scaffold/copy this folder directly
into your user extensions directory (see `extensions_manage` → `guide` in
Copilot CLI) and run `extensions_reload`.

## Using it

1. Open the **Prompt Library** canvas (the agent can do this via
   `open_canvas`, or your host UI may expose it directly).
2. On first use, you'll be asked for a prompt root folder — an absolute
   path to an existing, readable/writable folder. See `examples/` in this
   repo for sample content to copy in and try search/tags/lifecycle with.
3. Search, filter by tag (match **any** by default, or toggle **match all**),
   and filter by lifecycle status (only `active` is shown by default).
4. Choose **Auto**, **Light**, or **Dark** from the **Theme** selector. Auto
   follows the operating system/browser color preference; Light and Dark
   override it. The canvas host currently does not expose Copilot's explicit
   theme selection to extensions.
5. Select a prompt to preview it, then **Copy prompt body** to copy the
   Markdown body to your clipboard so you can paste it into the Copilot
   composer yourself. The current canvas SDK does not expose a safe way to
   prefill the composer directly, so this is a deliberate one-click-copy,
   not an auto-submit.
6. Use **+ New Prompt** or **Edit** to create/update prompt files directly
   from the canvas; validation errors and save conflicts are shown inline.

### Agent-callable actions

Besides the interactive canvas, the extension exposes two read-only
actions any agent in the session can invoke directly (useful when an agent
wants prompt content in-conversation rather than relying on clipboard
paste):

- `search_prompts({ query?, tags?, tagMode?, statuses? })` — same filtering
  logic as the UI; returns metadata only (no bodies), including the
  `configured: false` case if no folder has been set up yet.
- `get_prompt({ relPath })` — fetches metadata + full body for one prompt by
  its relative path (as returned by `search_prompts`).

## Example prompts

The `examples/` folder in this repository (not your configured prompt
root — copy them in yourself to try things out) demonstrates:

| File | Demonstrates |
|------|--------------|
| `code-review-helper.md` | Full schema: tags, skills, agent, active status |
| `api-design-review.md` | A second `active` prompt sharing the `review` tag, for tag-filter testing |
| `modern-summary-prompt.md` | The current version of a prompt that replaced an older one |
| `legacy-summary-prompt.md` | `status: deprecated` + `replaced-by: modern-summary-prompt` |
| `brainstorm-feature-names.md` | `status: draft` (hidden by default) |
| `onboarding-buddy-2022.md` | `status: archived` (hidden by default) |
| `refactor-for-readability.prompt.md` | A VS Code-style `.prompt.md` file with no `name`/`title`, imported as-is |

## Development

```
npm test         # runs the unit tests (node:test), no build step needed
```

Tests cover: front-matter parse/serialize round trips (including unknown-field
preservation), metadata normalization/validation, search/filter logic
(tag any/all, status defaults, text search), and prompt-repo path
containment + create/update/conflict behavior.

There is no bundler/build step: `web/` is plain HTML/CSS/JS served directly
by a small Node `http` server the extension starts per open canvas instance
(one ephemeral port per instance), and `server/` is plain ES modules with no
third-party dependencies.

## Known limitations

- The canvas follows the embedded browser's `prefers-color-scheme` setting,
  including live changes when the host updates it. The current canvas SDK
  doesn't expose a separate theme API, so the canvas can't follow an app theme
  that the host doesn't propagate to the browser.
- No native folder picker — the root folder is entered as a text path. Canvas
  hosts don't currently expose a safe file/folder picker API to extensions.
- Clipboard copy relies on `navigator.clipboard`, which requires the canvas
  to be rendered in a context that grants clipboard permissions; if that
  fails, the UI surfaces a visible error rather than failing silently.
- The front-matter parser is a deliberate subset of YAML (see
  [Front-matter format](#front-matter-format-and-limitations)); pathological
  hand-written YAML outside that subset may not round-trip perfectly.
- External-change detection polls periodically rather than using filesystem
  watchers, to keep the implementation dependency-free and portable.
