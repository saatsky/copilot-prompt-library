// search.mjs
//
// Pure filtering/search logic over already-loaded prompt records, kept
// separate from filesystem/HTTP concerns so it's trivially unit-testable.

/**
 * @typedef {Object} PromptRecord
 * @property {string} relPath
 * @property {object} metadata Normalized metadata (see validate.mjs).
 * @property {string} body
 */

/**
 * @param {PromptRecord[]} prompts
 * @param {{ query?: string, tags?: string[], tagMode?: "any"|"all", statuses?: string[] }} options
 * @returns {PromptRecord[]}
 */
export function filterPrompts(prompts, options = {}) {
    const query = (options.query ?? "").trim().toLowerCase();
    const tags = (options.tags ?? []).filter(Boolean);
    const tagMode = options.tagMode === "all" ? "all" : "any";
    const statuses = options.statuses && options.statuses.length > 0 ? options.statuses : ["active"];

    return prompts.filter((p) => {
        if (!statuses.includes(p.metadata.status)) return false;

        if (tags.length > 0) {
            const promptTags = p.metadata.tags.map((t) => t.toLowerCase());
            const wanted = tags.map((t) => t.toLowerCase());
            const matches =
                tagMode === "all"
                    ? wanted.every((t) => promptTags.includes(t))
                    : wanted.some((t) => promptTags.includes(t));
            if (!matches) return false;
        }

        if (query) {
            const haystacks = [
                p.metadata.title,
                p.metadata.name,
                p.metadata.description,
                p.metadata.tags.join(" "),
                p.body,
            ]
                .join("\n")
                .toLowerCase();
            if (!haystacks.includes(query)) return false;
        }

        return true;
    });
}

/**
 * @param {PromptRecord[]} prompts
 * @returns {string[]} Sorted, de-duplicated tag list across all prompts.
 */
export function collectTags(prompts) {
    const set = new Set();
    for (const p of prompts) {
        for (const tag of p.metadata.tags) set.add(tag);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {PromptRecord[]} prompts
 * @returns {Map<string, PromptRecord[]>} Prompts grouped by `name`, to spot
 * duplicate identifiers across files.
 */
export function findDuplicateNames(prompts) {
    const byName = new Map();
    for (const p of prompts) {
        const list = byName.get(p.metadata.name) ?? [];
        list.push(p);
        byName.set(p.metadata.name, list);
    }
    for (const [name, list] of byName) {
        if (list.length <= 1) byName.delete(name);
    }
    return byName;
}
