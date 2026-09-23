// extension.mjs
//
// Prompt Library canvas: a local-first browser/editor for reusable Markdown
// prompts stored in a user-configured folder. Registers one canvas
// (`prompt-library`) that serves a small same-origin HTTP app (see
// server/http-app.mjs) per open instance, plus a couple of read-only
// agent-callable actions so the agent can search/fetch prompt bodies
// without needing clipboard access.
//
// @experimental Canvas support in the Copilot SDK is an experimental
// wire-protocol surface and may change in future CLI/SDK releases.

import { createServer } from "node:http";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import { createState, handleRequest } from "./server/http-app.mjs";
import { readConfig, validateRoot } from "./server/config-store.mjs";
import { scanPromptFiles, readPrompt } from "./server/prompt-repo.mjs";
import { filterPrompts } from "./server/search.mjs";

// instanceId -> { server, url, state }
const instances = new Map();

async function startInstance(instanceId) {
    const state = createState();
    const server = createServer((req, res) => {
        handleRequest(state, req, res).catch((err) => {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
        });
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const entry = { server, url: `http://127.0.0.1:${port}/`, state };
    instances.set(instanceId, entry);
    return entry;
}

/**
 * Resolves the currently configured prompt root for agent-callable actions,
 * independent of whether any canvas instance is open. Returns null when no
 * folder has been configured/validated yet.
 */
async function resolveConfiguredRoot() {
    const { rootPath } = await readConfig();
    if (!rootPath) return null;
    const check = await validateRoot(rootPath);
    return check.ok ? check.resolvedPath : null;
}

async function loadAllPrompts(root) {
    const files = await scanPromptFiles(root);
    const prompts = [];
    for (const file of files) {
        try {
            prompts.push(await readPrompt(root, file.relPath));
        } catch {
            // Skip unreadable files for agent-facing search; the canvas UI
            // surfaces per-file read errors separately.
        }
    }
    return prompts;
}

await joinSession({
    canvases: [
        createCanvas({
            id: "prompt-library",
            displayName: "Prompt Library",
            description:
                "Browse, search, and preview reusable Markdown prompts stored in a local folder, and copy them for use in the composer.",
            actions: [
                {
                    name: "search_prompts",
                    description:
                        "Search the configured prompt library by text query, tags, and lifecycle status. Returns matching prompt metadata (no body text).",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "Free-text search across title, name, description, tags, and body." },
                            tags: { type: "array", items: { type: "string" }, description: "Tags to filter by." },
                            tagMode: { type: "string", enum: ["any", "all"], description: "Match any (default) or all selected tags." },
                            statuses: {
                                type: "array",
                                items: { type: "string", enum: ["draft", "active", "deprecated", "archived"] },
                                description: "Lifecycle statuses to include. Defaults to ['active'].",
                            },
                        },
                    },
                    handler: async (ctx) => {
                        const root = await resolveConfiguredRoot();
                        if (!root) {
                            return { configured: false, message: "No prompt folder is configured yet. Open the Prompt Library canvas to set one." };
                        }
                        const prompts = await loadAllPrompts(root);
                        const input = ctx.input ?? {};
                        const filtered = filterPrompts(prompts, {
                            query: input.query,
                            tags: input.tags,
                            tagMode: input.tagMode,
                            statuses: input.statuses,
                        });
                        return {
                            configured: true,
                            rootPath: root,
                            count: filtered.length,
                            prompts: filtered.map((p) => ({
                                relPath: p.relPath,
                                name: p.metadata.name,
                                title: p.metadata.title,
                                description: p.metadata.description,
                                tags: p.metadata.tags,
                                status: p.metadata.status,
                                version: p.metadata.version,
                                replacedBy: p.metadata.replacedBy,
                            })),
                        };
                    },
                },
                {
                    name: "get_prompt",
                    description: "Fetch the full body and metadata of a single prompt by its relative path within the configured prompt folder.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            relPath: { type: "string", description: "Relative path returned by search_prompts, e.g. 'demo/code-review.md'." },
                        },
                        required: ["relPath"],
                    },
                    handler: async (ctx) => {
                        const root = await resolveConfiguredRoot();
                        if (!root) {
                            return { configured: false, message: "No prompt folder is configured yet." };
                        }
                        const prompt = await readPrompt(root, ctx.input.relPath);
                        return {
                            configured: true,
                            relPath: prompt.relPath,
                            metadata: prompt.metadata,
                            warnings: prompt.warnings,
                            body: prompt.body,
                        };
                    },
                },
            ],
            open: async (ctx) => {
                let entry = instances.get(ctx.instanceId);
                if (!entry) {
                    entry = await startInstance(ctx.instanceId);
                }
                return { title: "Prompt Library", url: entry.url };
            },
            onClose: async (ctx) => {
                const entry = instances.get(ctx.instanceId);
                if (entry) {
                    instances.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
