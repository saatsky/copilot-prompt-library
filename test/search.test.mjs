import { test } from "node:test";
import assert from "node:assert/strict";
import { filterPrompts, collectTags, findDuplicateNames } from "../server/search.mjs";

function prompt(overrides) {
    return {
        relPath: overrides.relPath ?? "p.md",
        body: overrides.body ?? "",
        metadata: {
            name: "n",
            title: "Title",
            description: "",
            tags: [],
            skills: [],
            agent: "",
            status: "active",
            version: "1.0.0",
            replacedBy: null,
            ...overrides.metadata,
        },
    };
}

test("defaults to active-only status filtering", () => {
    const prompts = [
        prompt({ metadata: { status: "active" } }),
        prompt({ metadata: { status: "draft" } }),
        prompt({ metadata: { status: "archived" } }),
    ];
    const result = filterPrompts(prompts, {});
    assert.equal(result.length, 1);
    assert.equal(result[0].metadata.status, "active");
});

test("tag filter defaults to match-any", () => {
    const prompts = [
        prompt({ relPath: "a.md", metadata: { tags: ["x"] } }),
        prompt({ relPath: "b.md", metadata: { tags: ["y"] } }),
        prompt({ relPath: "c.md", metadata: { tags: [] } }),
    ];
    const result = filterPrompts(prompts, { tags: ["x", "y"] });
    assert.deepEqual(
        result.map((p) => p.relPath).sort(),
        ["a.md", "b.md"],
    );
});

test("tag filter match-all requires every selected tag", () => {
    const prompts = [
        prompt({ relPath: "a.md", metadata: { tags: ["x", "y"] } }),
        prompt({ relPath: "b.md", metadata: { tags: ["x"] } }),
    ];
    const result = filterPrompts(prompts, { tags: ["x", "y"], tagMode: "all" });
    assert.deepEqual(result.map((p) => p.relPath), ["a.md"]);
});

test("text query matches title, tags, description, and body", () => {
    const prompts = [
        prompt({ relPath: "a.md", metadata: { title: "Alpha" } }),
        prompt({ relPath: "b.md", body: "mentions banana here" }),
        prompt({ relPath: "c.md", metadata: { description: "about banana bread" } }),
        prompt({ relPath: "d.md" }),
    ];
    const result = filterPrompts(prompts, { query: "banana" });
    assert.deepEqual(
        result.map((p) => p.relPath).sort(),
        ["b.md", "c.md"],
    );
});

test("collectTags de-duplicates and sorts", () => {
    const prompts = [prompt({ metadata: { tags: ["b", "a"] } }), prompt({ metadata: { tags: ["a", "c"] } })];
    assert.deepEqual(collectTags(prompts), ["a", "b", "c"]);
});

test("findDuplicateNames only reports names used by more than one file", () => {
    const prompts = [
        prompt({ relPath: "a.md", metadata: { name: "dup" } }),
        prompt({ relPath: "b.md", metadata: { name: "dup" } }),
        prompt({ relPath: "c.md", metadata: { name: "unique" } }),
    ];
    const dupes = findDuplicateNames(prompts);
    assert.deepEqual([...dupes.keys()], ["dup"]);
});
