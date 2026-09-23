import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePrompt, validateNewPrompt, isValidSemver, isValidName } from "../server/validate.mjs";

test("normalizes a fully specified prompt with no warnings", () => {
    const { metadata, warnings, unknownKeys } = normalizePrompt(
        {
            name: "code-review",
            title: "Code Review",
            description: "Reviews code.",
            tags: ["review"],
            skills: ["security-review"],
            agent: "code-review",
            status: "active",
            version: "1.0.0",
        },
        "code-review.md",
    );
    assert.equal(metadata.name, "code-review");
    assert.equal(metadata.status, "active");
    assert.deepEqual(warnings, []);
    assert.deepEqual(unknownKeys, []);
});

test("fills sensible fallbacks and warns for missing metadata instead of excluding the file", () => {
    const { metadata, warnings } = normalizePrompt({}, "my-cool-prompt.md");
    assert.equal(metadata.name, "my-cool-prompt");
    assert.equal(metadata.title, "My Cool Prompt");
    assert.equal(metadata.status, "active");
    assert.ok(warnings.some((w) => w.includes("name")));
    assert.ok(warnings.some((w) => w.includes("title")));
    assert.ok(warnings.some((w) => w.includes("status")));
    assert.ok(warnings.some((w) => w.includes("version")));
});

test("falls back invalid status to active with a warning", () => {
    const { metadata, warnings } = normalizePrompt({ status: "bogus" }, "p.md");
    assert.equal(metadata.status, "active");
    assert.ok(warnings.some((w) => w.includes("bogus")));
});

test("coerces a non-list tags value to a single-item list with a warning", () => {
    const { metadata, warnings } = normalizePrompt({ tags: "solo" }, "p.md");
    assert.deepEqual(metadata.tags, ["solo"]);
    assert.ok(warnings.some((w) => w.includes("tags")));
});

test("preserves unknown fields (e.g. VS Code prompt fields) in unknownKeys", () => {
    const { unknownKeys } = normalizePrompt({ "argument-hint": "<x>", model: "GPT-4o", mode: "agent" }, "p.md");
    assert.deepEqual(unknownKeys.sort(), ["argument-hint", "mode", "model"]);
});

test("validateNewPrompt requires name/title and valid status/version", () => {
    assert.deepEqual(validateNewPrompt({ name: "ok-name", title: "T", status: "active", version: "1.0.0" }), []);
    const errors = validateNewPrompt({ name: "", title: "", status: "nope", version: "abc" });
    assert.equal(errors.length, 4);
});

test("isValidSemver / isValidName", () => {
    assert.equal(isValidSemver("1.2.3"), true);
    assert.equal(isValidSemver("1.2"), false);
    assert.equal(isValidName("valid-name.1"), true);
    assert.equal(isValidName("Invalid Name"), false);
});
