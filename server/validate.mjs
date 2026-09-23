// validate.mjs
//
// Normalizes raw front-matter data into the interoperable prompt metadata
// model, producing user-facing warnings for missing/invalid fields instead
// of silently excluding files. Nothing here mutates the original parsed
// data — callers keep the raw object around so unknown fields survive a
// round trip through the editor.

export const LIFECYCLE_STATUSES = ["draft", "active", "deprecated", "archived"];
export const DEFAULT_STATUS = "active";
export const DEFAULT_VERSION = "1.0.0";

const KNOWN_KEYS = new Set([
    "name",
    "title",
    "description",
    "tags",
    "skills",
    "agent",
    "status",
    "version",
    "replaced-by",
]);

const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * @param {string} relPath Forward-slash relative path used as a fallback id.
 * @returns {string}
 */
function fallbackNameFromPath(relPath) {
    const base = relPath.split("/").pop() ?? relPath;
    return base.replace(/\.prompt\.md$/i, "").replace(/\.md$/i, "");
}

function titleCase(slug) {
    return slug
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function toStringArray(value, warnings, fieldName) {
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) return value.map((v) => String(v));
    warnings.push(`'${fieldName}' should be a YAML list; treating the single value as one entry.`);
    return [String(value)];
}

/**
 * @param {Record<string, unknown>} data Raw parsed front matter.
 * @param {string} relPath Forward-slash path relative to the prompt root.
 * @returns {{ metadata: object, warnings: string[], unknownKeys: string[] }}
 */
export function normalizePrompt(data, relPath) {
    const warnings = [];
    const fallbackName = fallbackNameFromPath(relPath);

    let name = data.name !== undefined && data.name !== null ? String(data.name) : "";
    if (!name) {
        warnings.push(`Missing 'name'; using filename '${fallbackName}' as a temporary identifier.`);
        name = fallbackName;
    } else if (!NAME_RE.test(name)) {
        warnings.push(
            `'name' should match ^[a-z0-9][a-z0-9._-]*$ for stable cross-tool references (found '${name}').`,
        );
    }

    let title = data.title !== undefined && data.title !== null ? String(data.title) : "";
    if (!title) {
        warnings.push("Missing 'title'; using a title derived from the filename.");
        title = titleCase(fallbackName);
    }

    const description = data.description !== undefined && data.description !== null ? String(data.description) : "";

    const tags = toStringArray(data.tags, warnings, "tags");
    const skills = toStringArray(data.skills, warnings, "skills");

    const agent = data.agent !== undefined && data.agent !== null ? String(data.agent) : "";

    let status = data.status !== undefined && data.status !== null ? String(data.status) : "";
    if (!status) {
        warnings.push(`Missing 'status'; treating as '${DEFAULT_STATUS}'.`);
        status = DEFAULT_STATUS;
    } else if (!LIFECYCLE_STATUSES.includes(status)) {
        warnings.push(
            `Unrecognized 'status' value '${status}'; expected one of ${LIFECYCLE_STATUSES.join(", ")}. Treating as '${DEFAULT_STATUS}'.`,
        );
        status = DEFAULT_STATUS;
    }

    let version = data.version !== undefined && data.version !== null ? String(data.version) : "";
    if (!version) {
        warnings.push("Missing 'version'.");
    } else if (!SEMVER_RE.test(version)) {
        warnings.push(`'version' ('${version}') does not look like semantic versioning (e.g. 1.0.0).`);
    }

    const replacedBy = data["replaced-by"] !== undefined && data["replaced-by"] !== null ? String(data["replaced-by"]) : "";
    if (status !== "deprecated" && replacedBy) {
        warnings.push("'replaced-by' is set but status is not 'deprecated'.");
    }

    const unknownKeys = Object.keys(data).filter((k) => !KNOWN_KEYS.has(k));

    return {
        metadata: {
            name,
            title,
            description,
            tags,
            skills,
            agent,
            status,
            version: version || null,
            replacedBy: replacedBy || null,
        },
        warnings,
        unknownKeys,
    };
}

/**
 * Validates a payload intended to create a brand-new prompt, where the
 * interoperable fields are required rather than merely recommended.
 * @param {Record<string, unknown>} input
 * @returns {string[]} Validation error messages; empty when valid.
 */
export function validateNewPrompt(input) {
    const errors = [];
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const status = typeof input.status === "string" && input.status ? input.status : DEFAULT_STATUS;
    const version = typeof input.version === "string" && input.version ? input.version : DEFAULT_VERSION;

    if (!name) errors.push("'name' is required.");
    else if (!NAME_RE.test(name)) errors.push("'name' must match ^[a-z0-9][a-z0-9._-]*$.");

    if (!title) errors.push("'title' is required.");
    if (!LIFECYCLE_STATUSES.includes(status)) {
        errors.push(`'status' must be one of ${LIFECYCLE_STATUSES.join(", ")}.`);
    }
    if (!SEMVER_RE.test(version)) errors.push("'version' must be a semantic version, e.g. 1.0.0.");

    return errors;
}

export function isValidSemver(version) {
    return SEMVER_RE.test(version);
}

export function isValidName(name) {
    return NAME_RE.test(name);
}
