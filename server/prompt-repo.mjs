// prompt-repo.mjs
//
// Filesystem access for the configured prompt root: recursive discovery of
// `.md`/`.prompt.md` files, safe read/write with strict path containment,
// and optimistic-concurrency conflict detection on save.

import { promises as fs } from "node:fs";
import path from "node:path";
import { parseMarkdownFile, serializeMarkdownFile } from "./frontmatter.mjs";
import { normalizePrompt } from "./validate.mjs";

const MAX_FILES = 5000;
const MAX_DEPTH = 20;
const SKIP_DIR_NAMES = new Set(["node_modules", ".git", ".hg", ".svn"]);

export class PathTraversalError extends Error {
    constructor(message) {
        super(message);
        this.name = "PathTraversalError";
    }
}

export class NotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = "NotFoundError";
    }
}

export class ConflictError extends Error {
    constructor(message) {
        super(message);
        this.name = "ConflictError";
    }
}

export class AlreadyExistsError extends Error {
    constructor(message) {
        super(message);
        this.name = "AlreadyExistsError";
    }
}

/**
 * Resolves a caller-supplied relative path against `root`, guaranteeing the
 * result stays inside `root`. Rejects absolute paths, `..` traversal, and
 * null bytes before ever touching the filesystem.
 * @param {string} root Absolute, resolved root directory.
 * @param {string} relPath Forward-slash relative path, e.g. "team/foo.md".
 * @returns {string} Absolute path guaranteed to be within `root`.
 */
export function resolveContained(root, relPath) {
    if (typeof relPath !== "string" || relPath.length === 0) {
        throw new PathTraversalError("A relative path is required.");
    }
    if (relPath.includes("\0")) {
        throw new PathTraversalError("Path contains an invalid character.");
    }
    if (path.isAbsolute(relPath) || /^[A-Za-z]:/.test(relPath)) {
        throw new PathTraversalError(`Absolute paths are not allowed: ${relPath}`);
    }
    const normalized = path.normalize(relPath).replace(/\\/g, "/");
    if (normalized.split("/").some((seg) => seg === "..")) {
        throw new PathTraversalError(`Path escapes the prompt root: ${relPath}`);
    }
    const resolvedRoot = path.resolve(root);
    const candidate = path.resolve(resolvedRoot, normalized);
    const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
    if (candidate !== resolvedRoot && !candidate.startsWith(rootWithSep)) {
        throw new PathTraversalError(`Path escapes the prompt root: ${relPath}`);
    }
    return candidate;
}

function toRelPosix(root, absPath) {
    return path.relative(root, absPath).split(path.sep).join("/");
}

function isPromptFile(fileName) {
    return fileName.toLowerCase().endsWith(".md");
}

/**
 * Recursively discovers prompt files under `root`. Hidden directories,
 * VCS/dependency directories, and symlinks (files or directories) are
 * skipped so link cycles can't cause runaway recursion and so files can't
 * silently point outside the configured root.
 * @param {string} root
 * @returns {Promise<Array<{ relPath: string, absPath: string, mtimeMs: number, size: number }>>}
 */
export async function scanPromptFiles(root) {
    const resolvedRoot = path.resolve(root);
    const results = [];

    async function walk(dir, depth) {
        if (results.length >= MAX_FILES || depth > MAX_DEPTH) return;
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (results.length >= MAX_FILES) return;
            if (entry.isSymbolicLink()) continue;
            if (entry.name.startsWith(".")) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (SKIP_DIR_NAMES.has(entry.name)) continue;
                await walk(full, depth + 1);
            } else if (entry.isFile() && isPromptFile(entry.name)) {
                const stat = await fs.stat(full);
                results.push({
                    relPath: toRelPosix(resolvedRoot, full),
                    absPath: full,
                    mtimeMs: stat.mtimeMs,
                    size: stat.size,
                });
            }
        }
    }

    await walk(resolvedRoot, 0);
    return results;
}

/**
 * Reads and parses a single prompt file into raw front matter, normalized
 * metadata, warnings, body, and the mtime callers need for conflict checks.
 * @param {string} root
 * @param {string} relPath
 */
export async function readPrompt(root, relPath) {
    const absPath = resolveContained(root, relPath);
    let raw;
    let stat;
    try {
        raw = await fs.readFile(absPath, "utf8");
        stat = await fs.stat(absPath);
    } catch (err) {
        if (err.code === "ENOENT") throw new NotFoundError(`Prompt not found: ${relPath}`);
        throw err;
    }
    const { data, body, hasFrontMatter } = parseMarkdownFile(raw);
    const { metadata, warnings, unknownKeys } = normalizePrompt(data, relPath);
    if (!hasFrontMatter) {
        warnings.unshift("No front matter found; all fields are inferred from the filename.");
    }
    return {
        relPath,
        rawData: data,
        metadata,
        warnings,
        unknownKeys,
        body,
        mtimeMs: stat.mtimeMs,
    };
}

/**
 * Creates a new prompt file. Fails if the target already exists so a
 * name/path collision never silently overwrites an existing prompt.
 * @param {string} root
 * @param {string} relPath
 * @param {Record<string, unknown>} frontMatter
 * @param {string} body
 */
export async function createPrompt(root, relPath, frontMatter, body) {
    const absPath = resolveContained(root, relPath);
    if (!absPath.toLowerCase().endsWith(".md")) {
        throw new PathTraversalError("Prompt files must end with .md or .prompt.md.");
    }
    try {
        await fs.access(absPath);
        throw new AlreadyExistsError(`A prompt already exists at: ${relPath}`);
    } catch (err) {
        if (!(err instanceof AlreadyExistsError) && err.code !== "ENOENT") throw err;
        if (err instanceof AlreadyExistsError) throw err;
    }
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const content = serializeMarkdownFile(frontMatter, body);
    await fs.writeFile(absPath, content, { encoding: "utf8", flag: "wx" });
    const stat = await fs.stat(absPath);
    return { mtimeMs: stat.mtimeMs };
}

/**
 * Updates an existing prompt file, rejecting the write if the file changed
 * on disk since the caller last read it (optimistic concurrency).
 * @param {string} root
 * @param {string} relPath
 * @param {Record<string, unknown>} frontMatter
 * @param {string} body
 * @param {number} expectedMtimeMs
 */
export async function updatePrompt(root, relPath, frontMatter, body, expectedMtimeMs) {
    const absPath = resolveContained(root, relPath);
    let stat;
    try {
        stat = await fs.stat(absPath);
    } catch (err) {
        if (err.code === "ENOENT") throw new NotFoundError(`Prompt not found: ${relPath}`);
        throw err;
    }
    if (typeof expectedMtimeMs === "number" && Math.abs(stat.mtimeMs - expectedMtimeMs) > 1) {
        throw new ConflictError(
            `'${relPath}' changed on disk since it was loaded. Reload it before saving to avoid overwriting the newer version.`,
        );
    }
    const content = serializeMarkdownFile(frontMatter, body);
    await fs.writeFile(absPath, content, "utf8");
    const newStat = await fs.stat(absPath);
    return { mtimeMs: newStat.mtimeMs };
}
