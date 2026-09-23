import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdownFile, serializeMarkdownFile } from "../server/frontmatter.mjs";

test("parses basic front matter and body", () => {
    const raw = `---
name: code-review
title: Code Review Helper
tags:
  - review
  - quality
status: active
version: 1.2.0
---
Please review this code.
`;
    const { data, body, hasFrontMatter } = parseMarkdownFile(raw);
    assert.equal(hasFrontMatter, true);
    assert.equal(data.name, "code-review");
    assert.equal(data.title, "Code Review Helper");
    assert.deepEqual(data.tags, ["review", "quality"]);
    assert.equal(data.status, "active");
    assert.equal(data.version, "1.2.0");
    assert.equal(body, "Please review this code.\n");
});

test("parses inline lists and quoted scalars", () => {
    const raw = `---
tools: ['githubRepo', 'codebase']
description: "A short description"
mode: 'agent'
---
Body text.
`;
    const { data } = parseMarkdownFile(raw);
    assert.deepEqual(data.tools, ["githubRepo", "codebase"]);
    assert.equal(data.description, "A short description");
    assert.equal(data.mode, "agent");
});

test("treats a file with no front matter as body-only", () => {
    const raw = "# Just a heading\n\nSome content.\n";
    const { data, body, hasFrontMatter } = parseMarkdownFile(raw);
    assert.deepEqual(data, {});
    assert.equal(hasFrontMatter, false);
    assert.equal(body, raw);
});

test("round-trips known fields plus unknown fields without loss", () => {
    const original = {
        name: "demo",
        title: "Demo",
        tags: ["a", "b"],
        status: "active",
        version: "1.0.0",
        "argument-hint": "<file>",
        model: "GPT-4o",
    };
    const serialized = serializeMarkdownFile(original, "Body content.\n");
    const { data: reparsed, body } = parseMarkdownFile(serialized);
    assert.deepEqual(reparsed, original);
    assert.equal(body, "Body content.\n");
});

test("serializes known fields in canonical order before unknown fields", () => {
    const data = { model: "GPT-4o", title: "T", name: "n", status: "active", version: "1.0.0" };
    const serialized = serializeMarkdownFile(data, "hi\n");
    const lines = serialized.split("\n");
    const order = lines.filter((l) => /^[a-z-]+:/.test(l)).map((l) => l.split(":")[0]);
    assert.deepEqual(order, ["name", "title", "status", "version", "model"]);
});

test("quotes scalars that would otherwise be ambiguous YAML", () => {
    const serialized = serializeMarkdownFile({ title: "true", version: "1.0.0" }, "b\n");
    assert.match(serialized, /title: 'true'/);
});

test("handles empty list serialization/parse round trip", () => {
    const serialized = serializeMarkdownFile({ tags: [] }, "b\n");
    const { data } = parseMarkdownFile(serialized);
    assert.deepEqual(data.tags, []);
});
