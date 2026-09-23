// app.js — vanilla JS, no build step. Talks to the same-origin JSON API
// exposed by server/http-app.mjs.

const state = {
    rootPath: null,
    selectedTags: new Set(),
    tagModeAll: false,
    statuses: new Set(["active"]),
    query: "",
    prompts: [],
    tags: [],
    selectedRelPath: null,
    knownFiles: new Map(), // relPath -> mtimeMs, for external-change detection
    editing: null, // { mode: "new" | "edit", relPath?, expectedMtimeMs? }
};

const el = (id) => document.getElementById(id);

async function api(path, options) {
    const res = await fetch(path, options);
    const contentType = res.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json") ? await res.json() : null;
    if (!res.ok) {
        const message = data && data.error ? data.error : `Request failed (${res.status})`;
        const err = new Error(message);
        err.status = res.status;
        err.data = data;
        throw err;
    }
    return data;
}

// ---------- Root folder configuration ----------

async function refreshRootState() {
    const data = await api("/api/state");
    state.rootPath = data.rootPath;
    renderRootStatus(data.error);
    if (state.rootPath) await loadPrompts();
}

function renderRootStatus(error) {
    const box = el("root-status");
    if (state.rootPath && !error) {
        box.textContent = state.rootPath;
        box.classList.remove("error");
    } else if (error) {
        box.textContent = error;
        box.classList.add("error");
    } else {
        box.textContent = "No prompt folder configured yet.";
        box.classList.add("error");
    }
}

function toggleFolderPanel(show) {
    el("folder-panel").classList.toggle("hidden", !show);
    if (show) {
        el("folder-input").value = state.rootPath ?? "";
        el("folder-error").textContent = "";
        el("folder-input").focus();
    }
}

async function saveFolder() {
    const value = el("folder-input").value.trim();
    el("folder-error").textContent = "";
    try {
        const data = await api("/api/root", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rootPath: value }),
        });
        state.rootPath = data.rootPath;
        renderRootStatus(data.error);
        toggleFolderPanel(false);
        await loadPrompts();
    } catch (err) {
        el("folder-error").textContent = err.message;
    }
}

// ---------- Prompt list / search ----------

function currentQueryParams() {
    const params = new URLSearchParams();
    if (state.query) params.set("q", state.query);
    if (state.selectedTags.size > 0) params.set("tags", [...state.selectedTags].join(","));
    params.set("tagMode", state.tagModeAll ? "all" : "any");
    params.set("statuses", [...state.statuses].join(",") || "active");
    return params;
}

async function loadPrompts() {
    if (!state.rootPath) {
        state.prompts = [];
        state.tags = [];
        renderTagChips();
        renderPromptList();
        return;
    }
    const data = await api(`/api/prompts?${currentQueryParams()}`);
    state.prompts = data.prompts;
    state.tags = data.tags;
    renderTagChips();
    renderPromptList();
    renderBrokenFiles(data.broken);
}

function renderTagChips() {
    const container = el("tag-chips");
    container.innerHTML = "";
    for (const tag of state.tags) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "tag-chip" + (state.selectedTags.has(tag) ? " selected" : "");
        chip.textContent = tag;
        chip.setAttribute("aria-pressed", String(state.selectedTags.has(tag)));
        chip.addEventListener("click", () => {
            if (state.selectedTags.has(tag)) state.selectedTags.delete(tag);
            else state.selectedTags.add(tag);
            loadPrompts();
        });
        container.appendChild(chip);
    }
}

function statusBadge(status) {
    return `<span class="badge badge-status-${status}">${status}</span>`;
}

function renderPromptList() {
    el("prompt-count").textContent = `${state.prompts.length} prompt${state.prompts.length === 1 ? "" : "s"}`;
    const list = el("prompt-list");
    list.innerHTML = "";
    for (const p of state.prompts) {
        const item = document.createElement("li");
        item.className = "prompt-list-item" + (p.relPath === state.selectedRelPath ? " selected" : "");
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");
        const m = p.metadata;
        item.innerHTML = `
      <div class="prompt-title"><span>${escapeHtml(m.title)}</span>${statusBadge(m.status)}</div>
      ${m.description ? `<div class="prompt-desc">${escapeHtml(m.description)}</div>` : ""}
      <div class="prompt-tags">${m.tags.map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join("")}</div>
    `;
        item.addEventListener("click", () => selectPrompt(p.relPath));
        item.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                selectPrompt(p.relPath);
            }
        });
        list.appendChild(item);
    }
}

function renderBrokenFiles(broken) {
    const box = el("broken-files");
    if (!broken || broken.length === 0) {
        box.textContent = "";
        return;
    }
    box.innerHTML =
        `${broken.length} file(s) could not be read:<br>` +
        broken.map((b) => `&bull; ${escapeHtml(b.relPath)}: ${escapeHtml(b.warnings.join(" "))}`).join("<br>");
}

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Minimal safe Markdown preview ----------

function renderMarkdown(src) {
    const escaped = escapeHtml(src);
    const withFences = escaped.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
    const lines = withFences.split("\n");
    const htmlLines = [];
    let inList = false;
    for (const line of lines) {
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        if (heading) {
            if (inList) {
                htmlLines.push("</ul>");
                inList = false;
            }
            const level = heading[1].length;
            htmlLines.push(`<h${level}>${inline(heading[2])}</h${level}>`);
            continue;
        }
        const listItem = /^[-*]\s+(.*)$/.exec(line);
        if (listItem) {
            if (!inList) {
                htmlLines.push("<ul>");
                inList = true;
            }
            htmlLines.push(`<li>${inline(listItem[1])}</li>`);
            continue;
        }
        if (inList) {
            htmlLines.push("</ul>");
            inList = false;
        }
        if (line.trim() === "") {
            htmlLines.push("");
        } else if (line.startsWith("<pre>") || line.startsWith("</pre>") || line.includes("<code>")) {
            htmlLines.push(line);
        } else {
            htmlLines.push(`<p>${inline(line)}</p>`);
        }
    }
    if (inList) htmlLines.push("</ul>");
    return htmlLines.join("\n");
}

function inline(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

// ---------- Detail / preview ----------

async function selectPrompt(relPath) {
    state.selectedRelPath = relPath;
    state.editing = null;
    renderPromptList();
    const data = await api(`/api/prompts/content?path=${encodeURIComponent(relPath)}`);
    renderDetail(data);
}

function renderDetail(data) {
    el("detail-empty").classList.add("hidden");
    el("edit-view").classList.add("hidden");
    const view = el("detail-view");
    view.classList.remove("hidden");
    const m = data.metadata;
    const warnings = data.warnings ?? [];
    view.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${escapeHtml(m.title)}</h2>
        <div class="detail-meta">
          ${statusBadge(m.status)} &nbsp; v${escapeHtml(m.version ?? "?")} &nbsp;
          <code>${escapeHtml(data.relPath)}</code>
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-primary" id="copy-btn">Copy prompt body</button>
        <button class="btn btn-secondary" id="edit-btn">Edit</button>
      </div>
    </div>
    ${m.description ? `<p>${escapeHtml(m.description)}</p>` : ""}
    <div class="prompt-tags">
      ${m.tags.map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join("")}
      ${m.skills.map((s) => `<span class="badge" title="Advisory skill, not auto-loaded">skill: ${escapeHtml(s)}</span>`).join("")}
      ${m.agent ? `<span class="badge" title="Advisory preferred agent">agent: ${escapeHtml(m.agent)}</span>` : ""}
    </div>
    ${
        m.status === "deprecated" && m.replacedBy
            ? `<div class="warning-box">Deprecated. Replaced by <a href="#" data-goto="${escapeHtml(m.replacedBy)}">${escapeHtml(m.replacedBy)}</a>.</div>`
            : ""
    }
    ${
        warnings.length > 0
            ? `<div class="warning-box"><strong>Metadata warnings</strong><ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul></div>`
            : ""
    }
    ${
        data.unknownKeys && data.unknownKeys.length > 0
            ? `<p class="hint">Preserved extra fields: ${data.unknownKeys.map(escapeHtml).join(", ")}</p>`
            : ""
    }
    <div class="prompt-body">${renderMarkdown(data.body)}</div>
  `;
    view.querySelector("#copy-btn").addEventListener("click", () => copyToClipboard(data.body));
    view.querySelector("#edit-btn").addEventListener("click", () => openEditor({ mode: "edit", data }));
    const gotoLink = view.querySelector("[data-goto]");
    if (gotoLink) {
        gotoLink.addEventListener("click", async (e) => {
            e.preventDefault();
            const target = state.prompts.find((p) => p.metadata.name === gotoLink.dataset.goto);
            if (target) await selectPrompt(target.relPath);
        });
    }
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        flashStatus("Copied prompt body to clipboard.");
    } catch {
        flashStatus("Could not access the clipboard in this environment.", true);
    }
}

let statusTimer;
function flashStatus(message, isError) {
    const box = el("root-status");
    const prev = box.textContent;
    const prevClass = box.classList.contains("error");
    box.textContent = message;
    box.classList.toggle("error", Boolean(isError));
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
        box.textContent = prev;
        box.classList.toggle("error", prevClass);
    }, 2500);
}

// ---------- Create / edit form ----------

function openEditor({ mode, data }) {
    el("detail-empty").classList.add("hidden");
    el("detail-view").classList.add("hidden");
    const view = el("edit-view");
    view.classList.remove("hidden");
    const m = data?.metadata ?? { title: "", name: "", description: "", tags: [], skills: [], agent: "", status: "active", version: "1.0.0", replacedBy: "" };
    state.editing = { mode, relPath: data?.relPath, expectedMtimeMs: data?.mtimeMs };
    view.innerHTML = `
    <h2>${mode === "new" ? "New Prompt" : `Edit: ${escapeHtml(m.title)}`}</h2>
    <div id="edit-error" class="error-box hidden"></div>
    <div class="form-grid">
      <div><label for="f-name">name (stable id)</label><input id="f-name" value="${escapeHtml(m.name)}" /></div>
      <div><label for="f-title">title</label><input id="f-title" value="${escapeHtml(m.title)}" /></div>
      <div class="full"><label for="f-desc">description</label><input id="f-desc" value="${escapeHtml(m.description)}" /></div>
      <div><label for="f-tags">tags (comma-separated)</label><input id="f-tags" value="${escapeHtml((m.tags ?? []).join(", "))}" /></div>
      <div><label for="f-skills">skills (comma-separated, advisory)</label><input id="f-skills" value="${escapeHtml((m.skills ?? []).join(", "))}" /></div>
      <div><label for="f-agent">agent (advisory)</label><input id="f-agent" value="${escapeHtml(m.agent ?? "")}" /></div>
      <div>
        <label for="f-status">status</label>
        <select id="f-status">
          ${["draft", "active", "deprecated", "archived"].map((s) => `<option value="${s}" ${s === m.status ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <div><label for="f-version">version (semver)</label><input id="f-version" value="${escapeHtml(m.version ?? "1.0.0")}" /></div>
      <div><label for="f-replaced">replaced-by (prompt name)</label><input id="f-replaced" value="${escapeHtml(m.replacedBy ?? "")}" /></div>
      ${
          mode === "new"
              ? `<div class="full"><label for="f-relpath">file path (optional, relative to root)</label><input id="f-relpath" placeholder="auto-generated from name" /></div>`
              : ""
      }
      <div class="full"><label for="f-body">prompt body (Markdown)</label><textarea id="f-body" rows="14">${escapeHtml(data?.body ?? "")}</textarea></div>
      ${
          data?.unknownKeys && data.unknownKeys.length > 0
              ? `<div class="unknown-fields-note full">Extra fields preserved on save: ${data.unknownKeys.map(escapeHtml).join(", ")}</div>`
              : ""
      }
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" id="save-btn">Save</button>
      <button class="btn btn-secondary" id="cancel-btn">Cancel</button>
    </div>
  `;
    view.querySelector("#save-btn").addEventListener("click", saveEditor);
    view.querySelector("#cancel-btn").addEventListener("click", () => {
        state.editing = null;
        if (data) renderDetail(data);
        else {
            view.classList.add("hidden");
            el("detail-empty").classList.remove("hidden");
        }
    });
}

async function saveEditor() {
    const payload = {
        name: el("f-name").value.trim(),
        title: el("f-title").value.trim(),
        description: el("f-desc").value.trim(),
        tags: splitList(el("f-tags").value),
        skills: splitList(el("f-skills").value),
        agent: el("f-agent").value.trim(),
        status: el("f-status").value,
        version: el("f-version").value.trim(),
        replacedBy: el("f-replaced").value.trim(),
        body: el("f-body").value,
    };
    const errorBox = el("edit-error");
    errorBox.classList.add("hidden");
    try {
        let result;
        if (state.editing.mode === "new") {
            const relPathInput = el("f-relpath");
            if (relPathInput && relPathInput.value.trim()) payload.relPath = relPathInput.value.trim();
            result = await api("/api/prompts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
        } else {
            payload.relPath = state.editing.relPath;
            payload.expectedMtimeMs = state.editing.expectedMtimeMs;
            result = await api("/api/prompts/save", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
        }
        state.editing = null;
        state.selectedRelPath = result.relPath;
        await loadPrompts();
        renderDetail(result);
    } catch (err) {
        const messages = err.data && err.data.errors ? err.data.errors.join(" ") : err.message;
        errorBox.textContent = messages;
        errorBox.classList.remove("hidden");
    }
}

function splitList(value) {
    return value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
}

// ---------- External change detection ----------

async function pollForChanges() {
    if (!state.rootPath) return;
    try {
        const data = await api("/api/changes");
        const newMap = new Map(data.files.map((f) => [f.relPath, f.mtimeMs]));
        if (state.knownFiles.size > 0) {
            let changed = newMap.size !== state.knownFiles.size;
            if (!changed) {
                for (const [relPath, mtime] of newMap) {
                    if (state.knownFiles.get(relPath) !== mtime) {
                        changed = true;
                        break;
                    }
                }
            }
            if (changed) el("change-banner").classList.remove("hidden");
        }
        state.knownFiles = newMap;
    } catch {
        // Best-effort background polling; ignore transient errors.
    }
}

// ---------- Wiring ----------

function wireEvents() {
    el("change-folder-btn").addEventListener("click", () => toggleFolderPanel(true));
    el("folder-cancel-btn").addEventListener("click", () => toggleFolderPanel(false));
    el("folder-save-btn").addEventListener("click", saveFolder);
    el("refresh-btn").addEventListener("click", async () => {
        await api("/api/refresh", { method: "POST" });
        await loadPrompts();
        el("change-banner").classList.add("hidden");
    });
    el("banner-refresh-btn").addEventListener("click", async () => {
        await api("/api/refresh", { method: "POST" });
        await loadPrompts();
        el("change-banner").classList.add("hidden");
    });
    el("banner-dismiss-btn").addEventListener("click", () => el("change-banner").classList.add("hidden"));

    let debounce;
    el("search-input").addEventListener("input", (e) => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            state.query = e.target.value;
            loadPrompts();
        }, 200);
    });

    for (const checkbox of document.querySelectorAll(".status-filters input[type=checkbox]")) {
        checkbox.addEventListener("change", () => {
            state.statuses = new Set(
                [...document.querySelectorAll(".status-filters input[type=checkbox]:checked")].map((c) => c.value),
            );
            loadPrompts();
        });
    }

    el("tag-mode-all").addEventListener("change", (e) => {
        state.tagModeAll = e.target.checked;
        loadPrompts();
    });

    el("new-prompt-btn").addEventListener("click", () => openEditor({ mode: "new" }));
}

async function init() {
    wireEvents();
    if (!state.rootPath) {
        try {
            await refreshRootState();
        } catch (err) {
            renderRootStatus(err.message);
        }
        if (!state.rootPath) toggleFolderPanel(true);
    }
    setInterval(pollForChanges, 7000);
    pollForChanges();
}

init();
