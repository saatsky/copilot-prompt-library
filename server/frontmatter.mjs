// frontmatter.mjs
//
// A deliberately small, dependency-free parser/serializer for the flat YAML
// front-matter subset used by prompt files: string, boolean, number scalars
// and single-level lists of scalars. This is NOT a general YAML parser —
// nested maps, anchors, multi-document streams, block scalars (`|`, `>`) and
// similar constructs are out of scope. That keeps the extension free of
// third-party dependencies while covering every field this schema (and
// VS Code's `.prompt.md` front matter) actually uses.
//
// Field order is preserved on parse (via normal JS object key insertion
// order) so unknown fields can be round-tripped without being silently
// dropped or reordered relative to each other.

const FM_DELIMITER = "---";

/**
 * @typedef {Object} ParsedMarkdown
 * @property {Record<string, unknown>} data Front-matter fields in file order.
 * @property {string} body Markdown body (front matter stripped).
 * @property {boolean} hasFrontMatter Whether a front-matter block was found.
 */

/**
 * Parse a Markdown file's contents into front matter + body.
 * @param {string} raw
 * @returns {ParsedMarkdown}
 */
export function parseMarkdownFile(raw) {
    const normalized = raw.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");

    if (lines[0]?.trim() !== FM_DELIMITER) {
        return { data: {}, body: normalized, hasFrontMatter: false };
    }

    let closingIndex = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === FM_DELIMITER) {
            closingIndex = i;
            break;
        }
    }

    if (closingIndex === -1) {
        // Unterminated front matter — treat the whole file as body rather
        // than guessing; the caller surfaces this as a parse warning.
        return { data: {}, body: normalized, hasFrontMatter: false };
    }

    const fmLines = lines.slice(1, closingIndex);
    const bodyLines = lines.slice(closingIndex + 1);
    // Drop a single leading blank line so the body doesn't accumulate an
    // extra newline on every parse/serialize round trip.
    if (bodyLines[0] === "") {
        bodyLines.shift();
    }

    const data = parseFrontMatterLines(fmLines);
    return { data, body: bodyLines.join("\n"), hasFrontMatter: true };
}

function parseFrontMatterLines(fmLines) {
    /** @type {Record<string, unknown>} */
    const data = {};
    let i = 0;
    while (i < fmLines.length) {
        const line = fmLines[i];
        if (line.trim() === "" || line.trim().startsWith("#")) {
            i++;
            continue;
        }
        const match = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
        if (!match) {
            // Not a recognizable top-level key; skip defensively rather than
            // throwing, so a stray line doesn't take down the whole file.
            i++;
            continue;
        }
        const [, key, rest] = match;
        const trimmedRest = rest.trim();
        if (trimmedRest === "") {
            // Possible block list on following indented lines.
            const items = [];
            let j = i + 1;
            while (j < fmLines.length && /^[ \t]+-[ \t]?/.test(fmLines[j])) {
                const itemText = fmLines[j].replace(/^[ \t]+-[ \t]?/, "");
                items.push(parseScalar(itemText.trim()));
                j++;
            }
            data[key] = items;
            i = j;
        } else {
            data[key] = parseScalar(trimmedRest);
            i++;
        }
    }
    return data;
}

/**
 * @param {string} value
 * @returns {unknown}
 */
function parseScalar(value) {
    if (value.startsWith("[") && value.endsWith("]")) {
        const inner = value.slice(1, -1).trim();
        if (inner === "") return [];
        return splitInlineList(inner).map((item) => parseScalar(item.trim()));
    }
    if (
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2) ||
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
    ) {
        const quote = value[0];
        const inner = value.slice(1, -1);
        return quote === "'" ? inner.replace(/''/g, "'") : inner.replace(/\\"/g, '"');
    }
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null" || value === "~" || value === "") return null;
    if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
    if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value);
    return value;
}

function splitInlineList(inner) {
    const items = [];
    let depth = 0;
    let current = "";
    let quote = null;
    for (const ch of inner) {
        if (quote) {
            current += ch;
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === "[") depth++;
        if (ch === "]") depth--;
        if (ch === "," && depth === 0) {
            items.push(current);
            current = "";
            continue;
        }
        current += ch;
    }
    if (current.trim() !== "") items.push(current);
    return items;
}

const KNOWN_FIELD_ORDER = [
    "name",
    "title",
    "description",
    "tags",
    "skills",
    "agent",
    "status",
    "version",
    "replaced-by",
];

/**
 * Serialize front matter + body back into a Markdown file. Known fields are
 * emitted in canonical order; any other keys present in `data` are appended
 * afterward in their original (insertion) order so unrecognized metadata
 * (e.g. VS Code's `mode`, `model`, `tools`, `argument-hint`) is preserved.
 * @param {Record<string, unknown>} data
 * @param {string} body
 * @returns {string}
 */
export function serializeMarkdownFile(data, body) {
    const keys = Object.keys(data);
    if (keys.length === 0) {
        return body.endsWith("\n") ? body : `${body}\n`;
    }
    const ordered = [
        ...KNOWN_FIELD_ORDER.filter((k) => keys.includes(k)),
        ...keys.filter((k) => !KNOWN_FIELD_ORDER.includes(k)),
    ];
    const lines = [FM_DELIMITER];
    for (const key of ordered) {
        lines.push(...serializeField(key, data[key]));
    }
    lines.push(FM_DELIMITER, "");
    const bodyText = body.endsWith("\n") ? body : `${body}\n`;
    return `${lines.join("\n")}\n${bodyText}`.replace(/\n{2,}$/, "\n");
}

function serializeField(key, value) {
    if (Array.isArray(value)) {
        if (value.length === 0) return [`${key}: []`];
        return [`${key}:`, ...value.map((item) => `  - ${serializeScalar(item)}`)];
    }
    return [`${key}: ${serializeScalar(value)}`];
}

function serializeScalar(value) {
    if (value === null || value === undefined) return "null";
    if (typeof value === "boolean" || typeof value === "number") return String(value);
    const str = String(value);
    const needsQuoting =
        str === "" ||
        /^[\s]|[\s]$/.test(str) ||
        /^[-?:,[\]{}#&*!|>'"%@`]/.test(str) ||
        /: |:$/.test(str) ||
        /[\n\t]/.test(str) ||
        str === "true" ||
        str === "false" ||
        str === "null" ||
        /^-?\d+(\.\d+)?$/.test(str);
    if (!needsQuoting) return str;
    return `'${str.replace(/'/g, "''")}'`;
}
