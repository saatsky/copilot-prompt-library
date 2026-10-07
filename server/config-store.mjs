// config-store.mjs
//
// Persists the user's chosen prompt-root folder preference. This is
// intentionally independent of any single Copilot repository/session: it
// lives under the user's home directory so the same folder choice is
// remembered across every session that loads this extension.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR = path.join(os.homedir(), ".copilot", "prompt-library");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const THEME_MODES = new Set(["auto", "light", "dark"]);

export function isThemeMode(value) {
    return THEME_MODES.has(value);
}

/**
 * @returns {Promise<{ rootPath: string | null, theme: "auto" | "light" | "dark" }>}
 */
export async function readConfig() {
    try {
        const raw = await fs.readFile(CONFIG_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return {
            rootPath: typeof parsed.rootPath === "string" ? parsed.rootPath : null,
            theme: isThemeMode(parsed.theme) ? parsed.theme : "auto",
        };
    } catch (err) {
        if (err.code === "ENOENT") return { rootPath: null, theme: "auto" };
        throw err;
    }
}

/**
 * @param {{ rootPath: string | null, theme: "auto" | "light" | "dark" }} config
 */
export async function writeConfig(config) {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    const tmpFile = `${CONFIG_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmpFile, JSON.stringify(config, null, 2), "utf8");
    await fs.rename(tmpFile, CONFIG_FILE);
}

/**
 * Checks that a candidate root path exists, is a directory, and is
 * readable/writable, without following it into anything unexpected.
 * @param {string} candidatePath
 * @returns {Promise<{ ok: boolean, error?: string, resolvedPath?: string }>}
 */
export async function validateRoot(candidatePath) {
    if (!candidatePath || typeof candidatePath !== "string" || !candidatePath.trim()) {
        return { ok: false, error: "Please provide a folder path." };
    }
    const resolved = path.resolve(candidatePath.trim());
    let stat;
    try {
        stat = await fs.stat(resolved);
    } catch (err) {
        if (err.code === "ENOENT") return { ok: false, error: `Folder does not exist: ${resolved}` };
        return { ok: false, error: `Cannot access folder: ${err.message}` };
    }
    if (!stat.isDirectory()) {
        return { ok: false, error: `Not a folder: ${resolved}` };
    }
    try {
        await fs.access(resolved, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
        return { ok: false, error: `Folder is not readable/writable: ${resolved}` };
    }
    return { ok: true, resolvedPath: resolved };
}

export { CONFIG_FILE };
