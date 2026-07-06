type SkillSource = "user" | "project" | "plugin" | "custom";

interface SkillSummary {
  id: string;
  name: string;
  description: string;
  path: string;
  realPath: string;
  source: SkillSource;
  directory: string;
  warnings: string[];
  descriptionTokens: number;
  bodyTokens: number;
}

interface SkillFile {
  relativePath: string;
  size: number;
}

interface SkillDetail extends SkillSummary {
  content: string;
  frontmatter: Record<string, string>;
  body: string;
  bodyHtml: string;
  files: SkillFile[];
}

interface SkillFileContent {
  relativePath: string;
  size: number;
  binary: boolean;
  content: string | null;
  contentHtml: string | null;
}

const SOURCE_LABELS: Record<SkillSource, string> = {
  user: "User",
  project: "Project",
  plugin: "Plugin",
  custom: "Custom",
};

const ALL_SOURCES = Object.keys(SOURCE_LABELS) as SkillSource[];
const RELOAD_LABEL = "Reload";
const COPY_PATH_LABEL = "Copy path";

const state = {
  skills: [] as SkillSummary[],
  selectedId: null as string | null,
  query: "",
  activeSources: new Set<SkillSource>(["user", "project", "plugin", "custom"]),
};

const statsEl = document.getElementById("stats")!;
const searchEl = document.getElementById("search") as HTMLInputElement;
const reloadEl = document.getElementById("reload") as HTMLButtonElement;
const sourceFiltersEl = document.getElementById("source-filters")!;
const skillListEl = document.getElementById("skill-list")!;
const detailEl = document.getElementById("detail")!;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isSkillSource(value: string): value is SkillSource {
  return Object.prototype.hasOwnProperty.call(SOURCE_LABELS, value);
}

function parseUrlState(): void {
  const params = new URLSearchParams(location.search);
  const skillParam = params.get("skill");
  const sourceParam = params.get("sources");

  state.query = params.get("q") ?? "";
  state.selectedId = skillParam && skillParam.trim() ? skillParam : null;
  state.activeSources =
    sourceParam === null
      ? new Set(ALL_SOURCES)
      : new Set(sourceParam.split(",").filter(isSkillSource));

  searchEl.value = state.query;
}

function syncUrlState(): void {
  const url = new URL(location.href);
  const activeSources = ALL_SOURCES.filter((source) => state.activeSources.has(source));

  if (state.selectedId) {
    url.searchParams.set("skill", state.selectedId);
  } else {
    url.searchParams.delete("skill");
  }

  if (state.query.trim()) {
    url.searchParams.set("q", state.query);
  } else {
    url.searchParams.delete("q");
  }

  if (activeSources.length === ALL_SOURCES.length) {
    url.searchParams.delete("sources");
  } else {
    url.searchParams.set("sources", activeSources.join(","));
  }

  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Markdown is rendered to HTML server-side (Bun.markdown) — links only need
// the browser-side attributes the server output does not carry.
function openMarkdownLinksInNewTab(root: ParentNode): void {
  root.querySelectorAll<HTMLAnchorElement>(".markdown-body a[href]").forEach((anchor) => {
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
  });
}

function getFilteredSkills(): SkillSummary[] {
  const query = state.query.trim().toLowerCase();

  return state.skills.filter((skill) => {
    if (!state.activeSources.has(skill.source)) return false;
    if (!query) return true;

    const haystack = [skill.name, skill.description, skill.path, skill.source]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

function renderSourceFilters(): void {
  const counts = state.skills.reduce(
    (acc, skill) => {
      acc[skill.source] = (acc[skill.source] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<SkillSource, number>>,
  );

  sourceFiltersEl.innerHTML = ALL_SOURCES.filter((source) => (counts[source] ?? 0) > 0)
    .map((source) => {
      const active = state.activeSources.has(source);
      return `<button class="filter-chip ${active ? "active" : ""}" data-source="${escapeHtml(source)}" aria-pressed="${active ? "true" : "false"}">
        ${escapeHtml(SOURCE_LABELS[source])} (${counts[source] ?? 0})
      </button>`;
    })
    .join("");

  sourceFiltersEl.querySelectorAll<HTMLButtonElement>(".filter-chip").forEach((button) => {
    button.addEventListener("click", () => {
      const source = button.dataset.source as SkillSource;
      if (state.activeSources.has(source)) {
        state.activeSources.delete(source);
      } else {
        state.activeSources.add(source);
      }
      renderSourceFilters();
      renderSkillList();
      syncUrlState();
    });
  });
}

function renderSkillList(): void {
  const filtered = getFilteredSkills();

  if (filtered.length === 0) {
    skillListEl.innerHTML = '<li class="list-empty">No skills match your filters.</li>';
    return;
  }

  skillListEl.innerHTML = filtered
    .map((skill) => {
      const active = skill.id === state.selectedId ? "active" : "";
      const warningBadge =
        skill.warnings.length > 0
          ? `<span class="badge badge-warning" title="${escapeHtml(skill.warnings.join("\n"))}" aria-label="${skill.warnings.length} warnings">⚠ ${skill.warnings.length}</span>`
          : "";
      return `<li>
        <button class="skill-item ${active}" data-id="${escapeHtml(skill.id)}" ${skill.id === state.selectedId ? 'aria-current="true"' : ""}>
          <div class="skill-item-title">
            <span>${escapeHtml(skill.name)}</span>
            <span class="skill-item-badges">
              ${warningBadge}
              <span class="badge badge-${escapeHtml(skill.source)}">${escapeHtml(SOURCE_LABELS[skill.source])}</span>
            </span>
          </div>
          <p class="skill-item-desc">${escapeHtml(skill.description || "No description")}</p>
        </button>
      </li>`;
    })
    .join("");

  skillListEl.querySelectorAll<HTMLButtonElement>(".skill-item").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id;
      if (!id) return;
      void selectSkill(id);
    });
  });
}

function renderEmptyDetail(): void {
  detailEl.innerHTML = `
    <div class="empty-state">
      <h2>Select a skill</h2>
      <p>Choose a skill from the list to view its contents.</p>
    </div>
  `;
}

function renderLoadingDetail(): void {
  detailEl.innerHTML = `<div class="empty-state"><p>Loading…</p></div>`;
}

function selectedSkillExists(): boolean {
  return state.selectedId !== null && state.skills.some((skill) => skill.id === state.selectedId);
}

function clearSelectedSkill(): void {
  if (state.selectedId !== null) {
    state.selectedId = null;
    syncUrlState();
  }
}

let detailRequestSeq = 0;

async function loadSkillDetail(id: string, showError: boolean): Promise<void> {
  const seq = ++detailRequestSeq;

  let skill: SkillDetail;
  try {
    const response = await fetch(`/api/skills/${encodeURIComponent(id)}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    skill = (await response.json()) as SkillDetail;
  } catch {
    if (showError && seq === detailRequestSeq && state.selectedId === id) {
      detailEl.innerHTML = `<div class="empty-state"><p>Failed to load skill. Click the skill in the list to retry.</p></div>`;
    }
    return;
  }

  // Ignore out-of-order responses and responses for a no-longer-selected skill.
  if (seq !== detailRequestSeq || state.selectedId !== id) return;
  renderDetail(skill);
}

async function selectSkill(id: string): Promise<void> {
  state.selectedId = id;
  renderSkillList();
  syncUrlState();

  renderLoadingDetail();
  await loadSkillDetail(id, true);
}

function renderFilePanelShell(relativePath: string, bodyHtml: string): string {
  return `<div class="file-panel-header">
      <span class="file-panel-title">${escapeHtml(relativePath)}</span>
      <button class="file-panel-close" type="button">Close</button>
    </div>
    <div class="file-panel-body">${bodyHtml}</div>`;
}

function renderFileContent(file: SkillFileContent): string {
  if (file.binary || file.content === null) {
    return '<p class="file-panel-status">Binary file — not displayed</p>';
  }
  if (file.contentHtml !== null) {
    return `<div class="markdown-body">${file.contentHtml}</div>`;
  }
  return `<pre><code>${escapeHtml(file.content)}</code></pre>`;
}

function bindFileViewer(skill: SkillDetail): void {
  const panel = detailEl.querySelector<HTMLElement>(".file-panel");
  if (!panel) return;
  const buttons = Array.from(detailEl.querySelectorAll<HTMLButtonElement>(".file-button"));
  let openPath: string | null = null;
  let requestSeq = 0;

  function updateFileButtons(): void {
    buttons.forEach((button) => {
      const active = openPath !== null && button.dataset.path === openPath;
      button.classList.toggle("active", active);
      button.setAttribute("aria-expanded", active ? "true" : "false");
    });
  }

  function closePanel(): void {
    openPath = null;
    panel!.hidden = true;
    panel!.innerHTML = "";
    updateFileButtons();
  }

  function bindClose(): void {
    panel!
      .querySelector<HTMLButtonElement>(".file-panel-close")
      ?.addEventListener("click", closePanel);
  }

  async function openFile(path: string): Promise<void> {
    const seq = ++requestSeq;
    panel!.hidden = false;
    panel!.innerHTML = renderFilePanelShell(path, '<p class="file-panel-status">Loading…</p>');
    bindClose();

    let bodyHtml: string;
    try {
      const response = await fetch(
        `/api/skills/${encodeURIComponent(skill.id)}/file?path=${encodeURIComponent(path)}`,
      );
      if (response.ok) {
        const file = (await response.json()) as SkillFileContent;
        bodyHtml = renderFileContent(file);
      } else {
        let message = `Failed to load file (HTTP ${response.status}).`;
        try {
          const data = (await response.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          // Keep the generic message when the body is not JSON.
        }
        bodyHtml = `<p class="file-panel-status">${escapeHtml(message)}</p>`;
      }
    } catch {
      bodyHtml = '<p class="file-panel-status">Failed to load file.</p>';
    }

    if (seq !== requestSeq || openPath !== path) return;
    panel!.innerHTML = renderFilePanelShell(path, bodyHtml);
    openMarkdownLinksInNewTab(panel!);
    bindClose();
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const path = button.dataset.path;
      if (!path) return;
      if (openPath === path) {
        closePanel();
        return;
      }
      openPath = path;
      updateFileButtons();
      void openFile(path);
    });
  });
}

function bindCopyPath(skill: SkillDetail): void {
  const button = detailEl.querySelector<HTMLButtonElement>(".copy-path-button");
  if (!button) return;
  let resetTimer: number | undefined;

  function setTemporaryLabel(label: string): void {
    button!.textContent = label;
    if (resetTimer !== undefined) window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      button!.textContent = COPY_PATH_LABEL;
      resetTimer = undefined;
    }, 1500);
  }

  function fallbackCopy(): boolean {
    const pathEl = detailEl.querySelector<HTMLElement>(".detail-path");
    if (!pathEl) return false;

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(pathEl);
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      selection?.removeAllRanges();
    }
  }

  button.addEventListener("click", () => {
    void (async () => {
      let copied = false;
      try {
        await navigator.clipboard.writeText(skill.path);
        copied = true;
      } catch {
        copied = fallbackCopy();
      }
      setTemporaryLabel(copied ? "Copied" : "Copy failed");
    })();
  });
}

function renderDetail(skill: SkillDetail): void {
  const frontmatter = Object.entries(skill.frontmatter)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

  const warningsPanel =
    skill.warnings.length > 0
      ? `<div class="warning-panel">
          <h3>Warnings</h3>
          <ul>
            ${skill.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}
          </ul>
        </div>`
      : "";

  const auxFiles =
    skill.files.length > 0
      ? `<div class="aux-files">
          <h3>Additional files</h3>
          <ul class="file-list">
            ${skill.files
              .map(
                (file) => `<li>
                  <button class="file-button" type="button" data-path="${escapeHtml(file.relativePath)}" aria-expanded="false">
                    <span class="file-name">${escapeHtml(file.relativePath)}</span>
                    <span class="file-size">${escapeHtml(formatSize(file.size))}</span>
                  </button>
                </li>`,
              )
              .join("")}
          </ul>
          <div class="file-panel" hidden></div>
        </div>`
      : "";

  detailEl.innerHTML = `
    <article class="detail-card">
      <header class="detail-header">
        <h2>${escapeHtml(skill.name)}</h2>
        <div class="detail-meta">
          <span class="badge badge-${escapeHtml(skill.source)}">${escapeHtml(SOURCE_LABELS[skill.source])}</span>
          <span class="detail-path">${escapeHtml(skill.path)}</span>
          <button class="copy-path-button" type="button">${escapeHtml(COPY_PATH_LABEL)}</button>
          <span class="detail-tokens">≈${skill.descriptionTokens} tok description · ≈${skill.bodyTokens} tok total</span>
        </div>
      </header>
      ${
        skill.description
          ? `<p class="detail-description">${escapeHtml(skill.description)}</p>`
          : ""
      }
      ${warningsPanel}
      ${
        frontmatter
          ? `<details class="collapsible" open>
              <summary>Frontmatter</summary>
              <pre>${escapeHtml(frontmatter)}</pre>
            </details>`
          : ""
      }
      ${auxFiles}
      <div class="markdown-body">${skill.bodyHtml}</div>
    </article>
  `;

  openMarkdownLinksInNewTab(detailEl);
  bindFileViewer(skill);
  bindCopyPath(skill);
}

function updateStats(): void {
  const counts = state.skills.reduce(
    (acc, skill) => {
      acc[skill.source] = (acc[skill.source] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<SkillSource, number>>,
  );

  const parts = ALL_SOURCES.filter((source) => (counts[source] ?? 0) > 0).map(
    (source) => `${SOURCE_LABELS[source]}: ${counts[source]}`,
  );

  const totalDescriptionTokens = state.skills.reduce(
    (sum, skill) => sum + skill.descriptionTokens,
    0,
  );

  statsEl.textContent = `${state.skills.length} skills · ≈${totalDescriptionTokens} tok in descriptions${parts.length ? ` (${parts.join(" · ")})` : ""}`;
}

function applySkills(skills: SkillSummary[]): void {
  state.skills = skills;

  if (selectedSkillExists()) {
    // The selected skill may have changed on disk — refresh the open detail
    // pane silently (keep the current pane if the refresh fails).
    void loadSkillDetail(state.selectedId!, false);
  } else {
    // Also clears a stale "Failed to load skills" message after recovery.
    clearSelectedSkill();
    renderEmptyDetail();
  }

  updateStats();
  renderSourceFilters();
  renderSkillList();
}

async function refreshSkills(): Promise<void> {
  const response = await fetch("/api/skills");
  if (!response.ok) {
    throw new Error(`Failed to fetch skills (HTTP ${response.status})`);
  }
  const data = (await response.json()) as { skills: SkillSummary[] };
  applySkills(data.skills);
}

let reloadStatusTimer: number | undefined;

async function rescan(): Promise<void> {
  if (reloadStatusTimer !== undefined) {
    window.clearTimeout(reloadStatusTimer);
    reloadStatusTimer = undefined;
  }

  reloadEl.disabled = true;
  reloadEl.textContent = "Reloading…";
  reloadEl.setAttribute("aria-busy", "true");
  reloadEl.classList.remove("error");
  let failed = false;

  try {
    const response = await fetch("/api/rescan", { method: "POST" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as { skills: SkillSummary[] };
    applySkills(data.skills);
  } catch {
    failed = true;
  } finally {
    reloadEl.disabled = false;
    reloadEl.removeAttribute("aria-busy");

    if (failed) {
      reloadEl.textContent = "Failed";
      reloadEl.classList.add("error");
      reloadStatusTimer = window.setTimeout(() => {
        reloadEl.textContent = RELOAD_LABEL;
        reloadEl.classList.remove("error");
        reloadStatusTimer = undefined;
      }, 2000);
    } else {
      reloadEl.textContent = RELOAD_LABEL;
    }
  }
}

let eventsWereDisconnected = false;

function subscribeToEvents(): void {
  const events = new EventSource("/api/events");

  events.addEventListener("open", () => {
    // Changes made while the connection was down were never broadcast to us.
    if (eventsWereDisconnected) {
      eventsWereDisconnected = false;
      void refreshSkills().catch(() => {});
    }
  });

  events.addEventListener("error", () => {
    eventsWereDisconnected = true;
    if (events.readyState === EventSource.CLOSED) {
      // The browser gave up on auto-reconnect — start a fresh connection.
      events.close();
      setTimeout(subscribeToEvents, 5000);
    }
  });

  events.addEventListener("message", (event: MessageEvent<string>) => {
    let payload: unknown;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (
      typeof payload === "object" &&
      payload !== null &&
      (payload as { type?: unknown }).type === "skills-changed"
    ) {
      void refreshSkills().catch(() => {});
    }
  });
}

function applyUrlState(): void {
  parseUrlState();

  if (selectedSkillExists()) {
    renderLoadingDetail();
    void loadSkillDetail(state.selectedId!, true);
  } else {
    clearSelectedSkill();
    renderEmptyDetail();
  }

  renderSourceFilters();
  renderSkillList();
}

function isTextInputTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function closeOpenFilePanel(): boolean {
  const button = detailEl.querySelector<HTMLButtonElement>(
    ".file-panel:not([hidden]) .file-panel-close",
  );
  if (!button) return false;
  button.click();
  return true;
}

function focusFirstSkillItem(): void {
  skillListEl.querySelector<HTMLButtonElement>(".skill-item")?.focus();
}

function focusSiblingSkillItem(current: HTMLButtonElement, direction: 1 | -1): void {
  const buttons = Array.from(skillListEl.querySelectorAll<HTMLButtonElement>(".skill-item"));
  const index = buttons.indexOf(current);
  const next = buttons[index + direction];
  next?.focus();
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "/" && !isTextInputTarget(event.target)) {
    event.preventDefault();
    searchEl.focus();
    return;
  }

  if (event.key === "Escape" && closeOpenFilePanel()) {
    event.preventDefault();
    return;
  }

  if (event.key === "ArrowDown" && event.target === searchEl) {
    event.preventDefault();
    focusFirstSkillItem();
    return;
  }

  if (!(event.target instanceof HTMLButtonElement)) return;
  if (!event.target.classList.contains("skill-item")) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusSiblingSkillItem(event.target, 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    focusSiblingSkillItem(event.target, -1);
  }
}

async function init(): Promise<void> {
  parseUrlState();

  // Attach handlers and subscribe to events before the first fetch, so a
  // failed initial load still leaves the Reload button and SSE refresh alive.
  searchEl.addEventListener("input", () => {
    state.query = searchEl.value;
    renderSkillList();
    syncUrlState();
  });

  reloadEl.addEventListener("click", () => {
    void rescan();
  });

  window.addEventListener("popstate", applyUrlState);
  document.addEventListener("keydown", handleKeydown);

  subscribeToEvents();

  await refreshSkills();
  syncUrlState();
}

init().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  detailEl.innerHTML = `<div class="empty-state"><p>Failed to load skills: ${escapeHtml(message)}</p><p>Press Reload to try again.</p></div>`;
});
