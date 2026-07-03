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
  files: SkillFile[];
}

interface SkillFileContent {
  relativePath: string;
  size: number;
  binary: boolean;
  content: string | null;
}

const SOURCE_LABELS: Record<SkillSource, string> = {
  user: "User",
  project: "Project",
  plugin: "Plugin",
  custom: "Custom",
};

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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderMarkdown(markdown: string): string {
  const placeholders: string[] = [];

  function stash(html: string): string {
    const key = `@@PLACEHOLDER_${placeholders.length}@@`;
    placeholders.push(html);
    return key;
  }

  let text = escapeHtml(markdown);

  text = text.replace(/```([\s\S]*?)```/g, (_match, code: string) =>
    stash(`<pre><code>${code.trim()}</code></pre>`),
  );

  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) => stash(`<code>${code}</code>`));
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*(\S(?:[^*\n]*\S)?)\*(?!\*)/g, "$1<em>$2</em>");
  text = text.replace(/^###### (.+)$/gm, "<h6>$1</h6>");
  text = text.replace(/^##### (.+)$/gm, "<h5>$1</h5>");
  text = text.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  text = text.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  text = text.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  text = text.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  text = text.replace(/^> (.+)$/gm, "<blockquote><p>$1</p></blockquote>");
  text = text.replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>");
  text = text.replace(/(<li>.*<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`);
  text = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
  );

  const blocks = text.split(/\n{2,}/);
  text = blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (/^<(h[1-6]|ul|ol|pre|blockquote)/.test(trimmed)) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  placeholders.forEach((html, index) => {
    text = text.replaceAll(`@@PLACEHOLDER_${index}@@`, html);
  });

  return text;
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

  sourceFiltersEl.innerHTML = (Object.keys(SOURCE_LABELS) as SkillSource[])
    .filter((source) => (counts[source] ?? 0) > 0)
    .map((source) => {
      const active = state.activeSources.has(source);
      return `<button class="filter-chip ${active ? "active" : ""}" data-source="${source}">
        ${SOURCE_LABELS[source]} (${counts[source] ?? 0})
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
          ? `<span class="badge badge-warning" title="${escapeHtml(skill.warnings.join("\n"))}">⚠ ${skill.warnings.length}</span>`
          : "";
      return `<li>
        <button class="skill-item ${active}" data-id="${skill.id}">
          <div class="skill-item-title">
            <span>${escapeHtml(skill.name)}</span>
            <span class="skill-item-badges">
              ${warningBadge}
              <span class="badge badge-${skill.source}">${SOURCE_LABELS[skill.source]}</span>
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

  detailEl.innerHTML = `<div class="empty-state"><p>Loading...</p></div>`;
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
  if (file.relativePath.endsWith(".md")) {
    return `<div class="markdown-body">${renderMarkdown(file.content)}</div>`;
  }
  return `<pre><code>${escapeHtml(file.content)}</code></pre>`;
}

function bindFileViewer(skill: SkillDetail): void {
  const panel = detailEl.querySelector<HTMLElement>(".file-panel");
  if (!panel) return;
  const buttons = Array.from(detailEl.querySelectorAll<HTMLButtonElement>(".file-button"));
  let openPath: string | null = null;
  let requestSeq = 0;

  function closePanel(): void {
    openPath = null;
    panel!.hidden = true;
    panel!.innerHTML = "";
    buttons.forEach((button) => button.classList.remove("active"));
  }

  function bindClose(): void {
    panel!
      .querySelector<HTMLButtonElement>(".file-panel-close")
      ?.addEventListener("click", closePanel);
  }

  async function openFile(path: string): Promise<void> {
    const seq = ++requestSeq;
    panel!.hidden = false;
    panel!.innerHTML = renderFilePanelShell(path, '<p class="file-panel-status">Loading...</p>');
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
      buttons.forEach((other) => other.classList.toggle("active", other === button));
      void openFile(path);
    });
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
                  <button class="file-button" type="button" data-path="${escapeHtml(file.relativePath)}">
                    <span class="file-name">${escapeHtml(file.relativePath)}</span>
                    <span class="file-size">${formatSize(file.size)}</span>
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
          <span class="badge badge-${skill.source}">${SOURCE_LABELS[skill.source]}</span>
          <span class="detail-path">${escapeHtml(skill.path)}</span>
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
      <div class="markdown-body">${renderMarkdown(skill.body)}</div>
    </article>
  `;

  bindFileViewer(skill);
}

function updateStats(): void {
  const counts = state.skills.reduce(
    (acc, skill) => {
      acc[skill.source] = (acc[skill.source] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<SkillSource, number>>,
  );

  const parts = (Object.keys(SOURCE_LABELS) as SkillSource[])
    .filter((source) => (counts[source] ?? 0) > 0)
    .map((source) => `${SOURCE_LABELS[source]}: ${counts[source]}`);

  const totalDescriptionTokens = state.skills.reduce(
    (sum, skill) => sum + skill.descriptionTokens,
    0,
  );

  statsEl.textContent = `${state.skills.length} skills · ≈${totalDescriptionTokens} tok in descriptions${parts.length ? ` (${parts.join(" · ")})` : ""}`;
}

function applySkills(skills: SkillSummary[]): void {
  state.skills = skills;

  if (state.selectedId !== null && skills.some((skill) => skill.id === state.selectedId)) {
    // The selected skill may have changed on disk — refresh the open detail
    // pane silently (keep the current pane if the refresh fails).
    void loadSkillDetail(state.selectedId, false);
  } else {
    // Also clears a stale "Failed to load skills" message after recovery.
    state.selectedId = null;
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

async function rescan(): Promise<void> {
  reloadEl.disabled = true;
  try {
    const response = await fetch("/api/rescan", { method: "POST" });
    if (!response.ok) return;
    const data = (await response.json()) as { skills: SkillSummary[] };
    applySkills(data.skills);
  } finally {
    reloadEl.disabled = false;
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

async function init(): Promise<void> {
  // Attach handlers and subscribe to events before the first fetch, so a
  // failed initial load still leaves the Reload button and SSE refresh alive.
  searchEl.addEventListener("input", () => {
    state.query = searchEl.value;
    renderSkillList();
  });

  reloadEl.addEventListener("click", () => {
    void rescan().catch(() => {});
  });

  subscribeToEvents();

  await refreshSkills();
}

init().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  detailEl.innerHTML = `<div class="empty-state"><p>Failed to load skills: ${escapeHtml(message)}</p><p>Press Reload to try again.</p></div>`;
});
