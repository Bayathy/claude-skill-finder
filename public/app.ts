type SkillSource = "user" | "project" | "plugin" | "custom";

interface SkillSummary {
  id: string;
  name: string;
  description: string;
  path: string;
  realPath: string;
  source: SkillSource;
  directory: string;
}

interface SkillDetail extends SkillSummary {
  content: string;
  frontmatter: Record<string, string>;
  body: string;
  files: string[];
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

function toFileUrl(path: string): string {
  return `file://${path}`;
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

  text = text.replace(/`([^`\n]+)`/g, "<code>$1</code>");
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

    const haystack = [
      skill.name,
      skill.description,
      skill.path,
      skill.source,
    ]
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

  sourceFiltersEl.querySelectorAll<HTMLButtonElement>(".filter-chip").forEach(
    (button) => {
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
    },
  );
}

function renderSkillList(): void {
  const filtered = getFilteredSkills();

  if (filtered.length === 0) {
    skillListEl.innerHTML =
      '<li class="list-empty">No skills match your filters.</li>';
    return;
  }

  skillListEl.innerHTML = filtered
    .map((skill) => {
      const active = skill.id === state.selectedId ? "active" : "";
      return `<li>
        <button class="skill-item ${active}" data-id="${skill.id}">
          <div class="skill-item-title">
            <span>${escapeHtml(skill.name)}</span>
            <span class="badge badge-${skill.source}">${SOURCE_LABELS[skill.source]}</span>
          </div>
          <p class="skill-item-desc">${escapeHtml(skill.description || "No description")}</p>
        </button>
      </li>`;
    })
    .join("");

  skillListEl.querySelectorAll<HTMLButtonElement>(".skill-item").forEach(
    (button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.id;
        if (!id) return;
        void selectSkill(id);
      });
    },
  );
}

function renderEmptyDetail(): void {
  detailEl.innerHTML = `
    <div class="empty-state">
      <h2>Select a skill</h2>
      <p>Choose a skill from the list to view its contents.</p>
    </div>
  `;
}

async function selectSkill(id: string): Promise<void> {
  state.selectedId = id;
  renderSkillList();

  detailEl.innerHTML = `<div class="empty-state"><p>Loading...</p></div>`;

  const response = await fetch(`/api/skills/${encodeURIComponent(id)}`);
  if (!response.ok) {
    detailEl.innerHTML = `<div class="empty-state"><p>Failed to load skill.</p></div>`;
    return;
  }

  const skill = (await response.json()) as SkillDetail;
  renderDetail(skill);
}

function renderDetail(skill: SkillDetail): void {
  const frontmatter = Object.entries(skill.frontmatter)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

  const auxFiles =
    skill.files.length > 0
      ? `<div class="aux-files">
          <h3>Additional files</h3>
          <ul>
            ${skill.files
              .map(
                (file) =>
                  `<li><a href="${toFileUrl(file)}">${escapeHtml(file)}</a></li>`,
              )
              .join("")}
          </ul>
        </div>`
      : "";

  detailEl.innerHTML = `
    <article class="detail-card">
      <header class="detail-header">
        <h2>${escapeHtml(skill.name)}</h2>
        <div class="detail-meta">
          <span class="badge badge-${skill.source}">${SOURCE_LABELS[skill.source]}</span>
          <a href="${toFileUrl(skill.path)}">${escapeHtml(skill.path)}</a>
        </div>
      </header>
      ${
        skill.description
          ? `<p class="detail-description">${escapeHtml(skill.description)}</p>`
          : ""
      }
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

  statsEl.textContent = `${state.skills.length} skills${parts.length ? ` (${parts.join(" · ")})` : ""}`;
}

async function init(): Promise<void> {
  const response = await fetch("/api/skills");
  const data = (await response.json()) as { skills: SkillSummary[] };
  state.skills = data.skills;

  updateStats();
  renderSourceFilters();
  renderSkillList();
  renderEmptyDetail();

  searchEl.addEventListener("input", () => {
    state.query = searchEl.value;
    renderSkillList();
  });
}

init().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  detailEl.innerHTML = `<div class="empty-state"><p>Failed to load skills: ${escapeHtml(message)}</p></div>`;
});
