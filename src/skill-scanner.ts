import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getDefaultUserSkillDirs, getPluginCacheDir } from "./paths.ts";
import type { ScanOptions, SkillFile, SkillSource, SkillSummary } from "./types.ts";

const GLOB_PATTERN = "**/SKILL.md";
const KEBAB_CASE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_DESCRIPTION_LENGTH = 1024;

function joinBlockScalar(lines: string[], literal: boolean): string {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[0]!.trim() === "") {
    trimmed.shift();
  }
  while (trimmed.length > 0 && trimmed[trimmed.length - 1]!.trim() === "") {
    trimmed.pop();
  }

  const indents = trimmed
    .filter((line) => line.trim() !== "")
    .map((line) => line.length - line.trimStart().length);
  const indent = indents.length > 0 ? Math.min(...indents) : 0;
  const stripped = trimmed.map((line) => (line.trim() === "" ? "" : line.slice(indent)));

  if (literal) {
    return stripped.join("\n");
  }

  // Folded scalar: lines join with spaces, blank lines separate paragraphs.
  return stripped
    .join("\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.split("\n").join(" "))
    .join("\n");
}

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
  hasFrontmatter: boolean;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content, hasFrontmatter: false };
  }

  const frontmatter: Record<string, string> = {};
  const lines = match[1]!.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    const blockMatch = value.match(/^([|>])[+-]?$/);
    if (blockMatch) {
      const collected: string[] = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!;
        if (next.trim() !== "" && !/^[ \t]/.test(next)) break;
        collected.push(next);
        i++;
      }
      value = joinBlockScalar(collected, blockMatch[1] === "|");
    } else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body: match[2] ?? "", hasFrontmatter: true };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function computeWarnings(
  frontmatter: Record<string, string>,
  body: string,
  hasFrontmatter: boolean,
): string[] {
  const warnings: string[] = [];
  const name = frontmatter.name ?? "";
  const description = frontmatter.description ?? "";

  if (!hasFrontmatter) {
    warnings.push("No frontmatter block found");
  }

  if (name.trim().length === 0) {
    warnings.push("Missing 'name' in frontmatter");
  } else if (!KEBAB_CASE_PATTERN.test(name)) {
    warnings.push("Skill name is not kebab-case");
  }

  if (description.trim().length === 0) {
    warnings.push("Missing 'description' in frontmatter");
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    warnings.push(
      `Description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`,
    );
  }

  if (body.trim().length === 0) {
    warnings.push("Skill body is empty");
  }

  return warnings;
}

function markDuplicateNames(skills: SkillSummary[]): void {
  const byName = new Map<string, SkillSummary[]>();

  for (const skill of skills) {
    const group = byName.get(skill.name);
    if (group) {
      group.push(skill);
    } else {
      byName.set(skill.name, [skill]);
    }
  }

  for (const group of byName.values()) {
    if (group.length < 2) continue;

    for (const skill of group) {
      for (const other of group) {
        if (other === skill) continue;
        skill.warnings.push(`Duplicate skill name — also defined at ${other.path}`);
      }
    }
  }
}

export function hashPath(path: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(path);
  return hasher.digest("hex").slice(0, 16);
}

export function classifySource(
  skillPath: string,
  home: string,
  customRoots: string[],
): SkillSource {
  const normalized = resolve(skillPath);

  for (const root of customRoots) {
    const normalizedRoot = resolve(root);
    if (normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`)) {
      return "custom";
    }
  }

  const pluginCache = join(home, ".claude", "plugins", "cache");
  if (normalized.startsWith(`${pluginCache}/`)) {
    return "plugin";
  }

  for (const userDir of getDefaultUserSkillDirs(home)) {
    if (normalized === userDir || normalized.startsWith(`${userDir}/`)) {
      return "user";
    }
  }

  if (normalized.includes(`${join(".claude", "skills")}/`)) {
    return "project";
  }

  return "custom";
}

function findProjectSkillRoots(cwd: string): string[] {
  const roots: string[] = [];
  let dir = resolve(cwd);

  while (true) {
    const skillsDir = join(dir, ".claude", "skills");
    if (existsSync(skillsDir)) {
      roots.push(skillsDir);
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return roots;
}

async function collectSkillFiles(root: string): Promise<string[]> {
  const glob = new Bun.Glob(GLOB_PATTERN);
  const files: string[] = [];

  for await (const relativePath of glob.scan({
    cwd: root,
    onlyFiles: true,
    followSymlinks: true,
  })) {
    files.push(join(root, relativePath));
  }

  return files;
}

export async function buildScanRoots(options: ScanOptions = {}): Promise<{
  roots: string[];
  customRoots: string[];
}> {
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const customRoots = (options.paths ?? []).map((p) => resolve(p));

  const roots = new Set<string>([
    ...getDefaultUserSkillDirs(home),
    ...findProjectSkillRoots(cwd),
    ...customRoots,
  ]);

  if (options.all) {
    roots.add(getPluginCacheDir(home));
  }

  return {
    roots: [...roots].filter((root) => existsSync(root)),
    customRoots,
  };
}

export async function scanSkills(options: ScanOptions = {}): Promise<SkillSummary[]> {
  const home = options.home ?? homedir();
  const { roots, customRoots } = await buildScanRoots(options);
  const seenRealPaths = new Set<string>();
  const skills: SkillSummary[] = [];

  for (const root of roots) {
    const files = await collectSkillFiles(root);

    for (const filePath of files) {
      let realPath: string;
      try {
        realPath = await realpath(filePath);
      } catch {
        continue;
      }

      if (seenRealPaths.has(realPath)) continue;
      seenRealPaths.add(realPath);

      const content = await Bun.file(filePath).text();
      const { frontmatter, body, hasFrontmatter } = parseFrontmatter(content);
      const directory = dirname(filePath);
      const fallbackName = dirname(filePath).split("/").pop() ?? "unknown";

      skills.push({
        id: hashPath(realPath),
        name: frontmatter.name ?? fallbackName,
        description: frontmatter.description ?? "",
        path: filePath,
        realPath,
        source: classifySource(filePath, home, customRoots),
        directory,
        warnings: computeWarnings(frontmatter, body, hasFrontmatter),
        descriptionTokens: estimateTokens(frontmatter.description ?? ""),
        bodyTokens: estimateTokens(content),
      });
    }
  }

  skills.sort((a, b) => {
    const sourceOrder: Record<SkillSource, number> = {
      user: 0,
      project: 1,
      custom: 2,
      plugin: 3,
    };
    const sourceDiff = sourceOrder[a.source] - sourceOrder[b.source];
    if (sourceDiff !== 0) return sourceDiff;
    return a.name.localeCompare(b.name);
  });

  markDuplicateNames(skills);

  return skills;
}

export async function listDirectoryFiles(directory: string): Promise<SkillFile[]> {
  const glob = new Bun.Glob("**/*");
  const files: SkillFile[] = [];

  for await (const relativePath of glob.scan({
    cwd: directory,
    onlyFiles: true,
    followSymlinks: true,
  })) {
    if (relativePath === "SKILL.md") continue;

    files.push({
      relativePath,
      size: Bun.file(join(directory, relativePath)).size,
    });
  }

  return files.toSorted((a, b) => {
    if (a.relativePath < b.relativePath) return -1;
    if (a.relativePath > b.relativePath) return 1;
    return 0;
  });
}
