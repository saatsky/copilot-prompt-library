// http-app.mjs
//
// Same-origin HTTP API + static asset server for one canvas instance. Kept
// framework-free: a small manual router plus a couple of helpers.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, writeConfig, validateRoot, isThemeMode } from "./config-store.mjs";
import {
    scanPromptFiles,
    readPrompt,
    createPrompt,
    updatePrompt,
    resolveContained,
    PathTraversalError,
    NotFoundError,
    ConflictError,
    AlreadyExistsError,
} from "./prompt-repo.mjs";
import { filterPrompts, collectTags, findDuplicateNames } from "./search.mjs";
import { validateNewPrompt, DEFAULT_STATUS, DEFAULT_VERSION } from "./validate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, "..", "web");

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
};

/**
 * Creates fresh, per-instance in-memory state. Every open canvas instance
 * gets its own state object so instances never share cached prompt lists.
 */
export function createState() {
    return {
        rootPath: /** @type {string | null} */ (null),
        theme: "auto",
        prompts: /** @type {Map<string, object>} */ (new Map()),
        lastScanError: /** @type {string | null} */ (null),
    };
}

async function loadRootFromConfig(state) {
    const { rootPath, theme } = await readConfig();
    state.theme = theme;
    if (!rootPath) return;
    const check = await validateRoot(rootPath);
    if (check.ok) {
        state.rootPath = check.resolvedPath;
        await rescan(state);
    } else {
        state.lastScanError = check.error;
    }
}

async function rescan(state) {
    if (!state.rootPath) return;
    state.prompts.clear();
    state.lastScanError = null;
    let files;
    try {
        files = await scanPromptFiles(state.rootPath);
    } catch (err) {
        state.lastScanError = `Could not scan folder: ${err.message}`;
        return;
    }
    for (const file of files) {
        try {
            const prompt = await readPrompt(state.rootPath, file.relPath);
            state.prompts.set(file.relPath, prompt);
        } catch (err) {
            state.prompts.set(file.relPath, {
                relPath: file.relPath,
                rawData: {},
                metadata: null,
                warnings: [`Could not read/parse file: ${err.message}`],
                unknownKeys: [],
                body: "",
                mtimeMs: file.mtimeMs,
                error: true,
            });
        }
    }
}

function summarize(prompt) {
    return {
        relPath: prompt.relPath,
        metadata: prompt.metadata,
        warnings: prompt.warnings,
        unknownKeys: prompt.unknownKeys,
        mtimeMs: prompt.mtimeMs,
        error: Boolean(prompt.error),
    };
}

async function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                reject(new Error("Request body too large."));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            if (chunks.length === 0) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
                reject(new Error("Invalid JSON body."));
            }
        });
        req.on("error", reject);
    });
}

function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(payload),
        "Cache-Control": "no-store",
    });
    res.end(payload);
}

function errorStatus(err) {
    if (err instanceof PathTraversalError) return 400;
    if (err instanceof NotFoundError) return 404;
    if (err instanceof ConflictError) return 409;
    if (err instanceof AlreadyExistsError) return 409;
    return 500;
}

function buildFrontMatterFromRequest(body, previousRawData) {
    // Start from whatever unknown fields already existed on disk so an edit
    // never silently drops metadata the UI doesn't know about.
    const data = { ...(previousRawData ?? {}) };
    data.name = body.name;
    data.title = body.title;
    if (body.description) data.description = body.description;
    else delete data.description;
    data.tags = Array.isArray(body.tags) ? body.tags : [];
    if (Array.isArray(body.skills) && body.skills.length > 0) data.skills = body.skills;
    else delete data.skills;
    if (body.agent) data.agent = body.agent;
    else delete data.agent;
    data.status = body.status || DEFAULT_STATUS;
    data.version = body.version || DEFAULT_VERSION;
    if (body.replacedBy) data["replaced-by"] = body.replacedBy;
    else delete data["replaced-by"];
    return data;
}

function slugify(name) {
    return (
        name
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9._-]+/g, "-")
            .replace(/^-+|-+$/g, "") || "prompt"
    );
}

/**
 * @param {ReturnType<typeof createState>} state
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleRequest(state, req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const { pathname } = url;

    try {
        if (pathname === "/api/state" && req.method === "GET") {
            if (state.rootPath === null && state.lastScanError === null) {
                await loadRootFromConfig(state);
            }
            sendJson(res, 200, {
                rootPath: state.rootPath,
                theme: state.theme,
                error: state.lastScanError,
                promptCount: state.prompts.size,
            });
            return;
        }

        if (pathname === "/api/root" && req.method === "POST") {
            const body = await readJsonBody(req);
            const check = await validateRoot(body.rootPath ?? "");
            if (!check.ok) {
                sendJson(res, 400, { error: check.error });
                return;
            }
            state.rootPath = check.resolvedPath;
            const config = await readConfig();
            state.theme = config.theme;
            await writeConfig({ ...config, rootPath: check.resolvedPath });
            await rescan(state);
            sendJson(res, 200, {
                rootPath: state.rootPath,
                theme: state.theme,
                error: state.lastScanError,
                promptCount: state.prompts.size,
            });
            return;
        }

        if (pathname === "/api/theme" && req.method === "POST") {
            const body = await readJsonBody(req);
            if (!isThemeMode(body.theme)) {
                sendJson(res, 400, { error: "Theme must be 'auto', 'light', or 'dark'." });
                return;
            }
            const config = await readConfig();
            await writeConfig({ ...config, theme: body.theme });
            state.theme = body.theme;
            sendJson(res, 200, { theme: state.theme });
            return;
        }

        if (pathname === "/api/refresh" && req.method === "POST") {
            if (!state.rootPath) {
                sendJson(res, 400, { error: "No prompt folder configured yet." });
                return;
            }
            await rescan(state);
            sendJson(res, 200, {
                rootPath: state.rootPath,
                error: state.lastScanError,
                promptCount: state.prompts.size,
            });
            return;
        }

        if (pathname === "/api/changes" && req.method === "GET") {
            if (!state.rootPath) {
                sendJson(res, 200, { files: [] });
                return;
            }
            const files = await scanPromptFiles(state.rootPath);
            sendJson(
                res,
                200,
                { files: files.map((f) => ({ relPath: f.relPath, mtimeMs: f.mtimeMs })) },
            );
            return;
        }

        if (pathname === "/api/prompts" && req.method === "GET") {
            if (!state.rootPath) {
                sendJson(res, 200, { prompts: [], tags: [], duplicateNames: [] });
                return;
            }
            const query = url.searchParams.get("q") ?? "";
            const tags = (url.searchParams.get("tags") ?? "").split(",").filter(Boolean);
            const tagMode = url.searchParams.get("tagMode") === "all" ? "all" : "any";
            const statuses = (url.searchParams.get("statuses") ?? "active").split(",").filter(Boolean);

            const all = [...state.prompts.values()].filter((p) => !p.error);
            const broken = [...state.prompts.values()].filter((p) => p.error);
            const filtered = filterPrompts(all, { query, tags, tagMode, statuses });
            const duplicateNames = [...findDuplicateNames(all).keys()];

            sendJson(res, 200, {
                prompts: filtered
                    .sort((a, b) => a.metadata.title.localeCompare(b.metadata.title))
                    .map(summarize),
                tags: collectTags(all),
                duplicateNames,
                broken: broken.map(summarize),
            });
            return;
        }

        if (pathname === "/api/prompts/content" && req.method === "GET") {
            const relPath = url.searchParams.get("path") ?? "";
            if (!state.rootPath) {
                sendJson(res, 400, { error: "No prompt folder configured yet." });
                return;
            }
            const prompt = await readPrompt(state.rootPath, relPath);
            state.prompts.set(relPath, prompt);
            sendJson(res, 200, { ...summarize(prompt), body: prompt.body, rawData: prompt.rawData });
            return;
        }

        if (pathname === "/api/prompts" && req.method === "POST") {
            if (!state.rootPath) {
                sendJson(res, 400, { error: "No prompt folder configured yet." });
                return;
            }
            const body = await readJsonBody(req);
            const errors = validateNewPrompt(body);
            if (errors.length > 0) {
                sendJson(res, 422, { errors });
                return;
            }
            const relPath = body.relPath && body.relPath.trim() ? body.relPath.trim() : `${slugify(body.name)}.md`;
            const frontMatter = buildFrontMatterFromRequest(body, {});
            await createPrompt(state.rootPath, relPath, frontMatter, body.body ?? "");
            const prompt = await readPrompt(state.rootPath, relPath);
            state.prompts.set(relPath, prompt);
            sendJson(res, 201, { ...summarize(prompt), body: prompt.body });
            return;
        }

        if (pathname === "/api/prompts/save" && req.method === "PUT") {
            if (!state.rootPath) {
                sendJson(res, 400, { error: "No prompt folder configured yet." });
                return;
            }
            const body = await readJsonBody(req);
            const relPath = body.relPath;
            if (!relPath) {
                sendJson(res, 400, { error: "'relPath' is required." });
                return;
            }
            const errors = validateNewPrompt(body);
            if (errors.length > 0) {
                sendJson(res, 422, { errors });
                return;
            }
            const previous = state.prompts.get(relPath);
            const frontMatter = buildFrontMatterFromRequest(body, previous?.rawData);
            await updatePrompt(state.rootPath, relPath, frontMatter, body.body ?? "", body.expectedMtimeMs);
            const prompt = await readPrompt(state.rootPath, relPath);
            state.prompts.set(relPath, prompt);
            sendJson(res, 200, { ...summarize(prompt), body: prompt.body });
            return;
        }

        if (pathname.startsWith("/api/")) {
            sendJson(res, 404, { error: "Not found." });
            return;
        }

        await serveStatic(pathname, res);
    } catch (err) {
        sendJson(res, errorStatus(err), { error: err.message });
    }
}

async function serveStatic(pathname, res) {
    const relPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const absPath = resolveContained(WEB_DIR, relPath);
    try {
        const data = await fs.readFile(absPath);
        const ext = path.extname(absPath);
        res.writeHead(200, {
            "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
            "Cache-Control": "no-store",
        });
        res.end(data);
    } catch {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
    }
}
