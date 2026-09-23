import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    resolveContained,
    scanPromptFiles,
    readPrompt,
    createPrompt,
    updatePrompt,
    PathTraversalError,
    NotFoundError,
    ConflictError,
    AlreadyExistsError,
} from "../server/prompt-repo.mjs";

async function withTempRoot(fn) {
    const root = await mkdtemp(path.join(os.tmpdir(), "prompt-lib-test-"));
    try {
        await fn(root);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

test("resolveContained rejects traversal, absolute paths, and null bytes", async () => {
    await withTempRoot(async (root) => {
        assert.throws(() => resolveContained(root, "../outside.md"), PathTraversalError);
        assert.throws(() => resolveContained(root, "a/../../outside.md"), PathTraversalError);
        assert.throws(() => resolveContained(root, "/etc/passwd"), PathTraversalError);
        assert.throws(() => resolveContained(root, "C:\\Windows\\system32"), PathTraversalError);
        assert.throws(() => resolveContained(root, "bad\0name.md"), PathTraversalError);
        const ok = resolveContained(root, "sub/dir/file.md");
        assert.ok(ok.startsWith(path.resolve(root)));
    });
});

test("scanPromptFiles finds nested .md and .prompt.md files, skips hidden/vcs dirs", async () => {
    await withTempRoot(async (root) => {
        await mkdir(path.join(root, "team", ".git"), { recursive: true });
        await mkdir(path.join(root, "team"), { recursive: true });
        await writeFile(path.join(root, "top.md"), "top");
        await writeFile(path.join(root, "team", "nested.prompt.md"), "nested");
        await writeFile(path.join(root, "team", ".git", "hidden.md"), "should be skipped");
        await mkdir(path.join(root, ".hidden"), { recursive: true });
        await writeFile(path.join(root, ".hidden", "skip.md"), "skip");
        await writeFile(path.join(root, "notes.txt"), "ignored, wrong extension");

        const files = await scanPromptFiles(root);
        const relPaths = files.map((f) => f.relPath).sort();
        assert.deepEqual(relPaths, ["team/nested.prompt.md", "top.md"]);
    });
});

test("readPrompt normalizes metadata and reports missing-file errors", async () => {
    await withTempRoot(async (root) => {
        await writeFile(
            path.join(root, "a.md"),
            "---\nname: a\ntitle: A\nstatus: active\nversion: 1.0.0\n---\nBody\n",
        );
        const prompt = await readPrompt(root, "a.md");
        assert.equal(prompt.metadata.title, "A");
        assert.equal(prompt.body, "Body\n");

        await assert.rejects(() => readPrompt(root, "missing.md"), NotFoundError);
    });
});

test("createPrompt refuses to overwrite an existing file and enforces .md extension", async () => {
    await withTempRoot(async (root) => {
        await createPrompt(root, "new.md", { name: "new", title: "New", status: "active", version: "1.0.0" }, "Hi\n");
        const content = await readFile(path.join(root, "new.md"), "utf8");
        assert.match(content, /title: New/);

        await assert.rejects(
            () => createPrompt(root, "new.md", { name: "new", title: "New" }, "Hi again\n"),
            AlreadyExistsError,
        );
        await assert.rejects(
            () => createPrompt(root, "new.txt", { name: "new", title: "New" }, "Hi\n"),
            PathTraversalError,
        );
    });
});

test("updatePrompt detects conflicting concurrent edits via mtime", async () => {
    await withTempRoot(async (root) => {
        await createPrompt(root, "a.md", { name: "a", title: "A", status: "active", version: "1.0.0" }, "Body\n");
        const loaded = await readPrompt(root, "a.md");

        // Simulate an external edit landing after our read.
        await new Promise((resolve) => setTimeout(resolve, 20));
        await writeFile(path.join(root, "a.md"), "---\nname: a\ntitle: Changed Externally\n---\nNew body\n");

        await assert.rejects(
            () => updatePrompt(root, "a.md", { name: "a", title: "My Edit" }, "Edited\n", loaded.mtimeMs),
            ConflictError,
        );

        // Reading fresh and updating with the current mtime succeeds.
        const fresh = await readPrompt(root, "a.md");
        await updatePrompt(root, "a.md", { name: "a", title: "My Edit" }, "Edited\n", fresh.mtimeMs);
        const final = await readPrompt(root, "a.md");
        assert.equal(final.metadata.title, "My Edit");
        assert.equal(final.body, "Edited\n");
    });
});

test("preserves unknown front-matter fields through a read/update round trip", async () => {
    await withTempRoot(async (root) => {
        await writeFile(
            path.join(root, "vscode.prompt.md"),
            "---\ndescription: 'From VS Code'\nmode: 'agent'\nmodel: GPT-4o\ntools: ['githubRepo']\n---\nDo the thing.\n",
        );
        const loaded = await readPrompt(root, "vscode.prompt.md");
        assert.deepEqual(loaded.unknownKeys.sort(), ["mode", "model", "tools"]);

        // Simulate the editor saving with only known fields changed, but the
        // server-side merge (http-app.mjs buildFrontMatterFromRequest) keeps
        // rawData's unknown fields — here we exercise the lower-level repo
        // API directly by passing the merged object through, mirroring what
        // the HTTP layer does.
        const merged = { ...loaded.rawData, title: "Updated Title" };
        await updatePrompt(root, "vscode.prompt.md", merged, loaded.body, loaded.mtimeMs);

        const final = await readPrompt(root, "vscode.prompt.md");
        assert.equal(final.rawData.mode, "agent");
        assert.equal(final.rawData.model, "GPT-4o");
        assert.deepEqual(final.rawData.tools, ["githubRepo"]);
        assert.equal(final.rawData.title, "Updated Title");
    });
});
