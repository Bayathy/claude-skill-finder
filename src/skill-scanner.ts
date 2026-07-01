import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  getDefaultUserSkillDirs,
  getPluginCacheDir,
} from "./paths.ts";
import type { ScanOptions, SkillSource, SkillSummary } from "./types.ts";

const GLOB_PATTERN = "**/SKILL.md";

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body: match[2] ?? "" };
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
    if (
      normalized === normalizedRoot ||
      normalized.startsWith(`${normalizedRoot}/`)
    ) {
      return "custom";
    }
  }

  const pluginCache = join(home, ".claude", "plugins", "cache");
  if (normalized.startsWith(`${pluginCache}/`)) {
    return "plugin";
  }

  for (const userDir of getDefaultUserSkillDirs(home)) {
    if (
      normalized === userDir ||
      normalized.startsWith(`${userDir}/`)
    ) {
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

export async function scanSkills(
  options: ScanOptions = {},
): Promise<SkillSummary[]> {
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
      const { frontmatter } = parseFrontmatter(content);
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

  return skills;
}

export async function listDirectoryFiles(directory: string): Promise<string[]> {
  const glob = new Bun.Glob("*");
  const files: string[] = [];

  for await (const name of glob.scan({
    cwd: directory,
    onlyFiles: true,
    followSymlinks: true,
  })) {
    if (name !== "SKILL.md") {
      files.push(join(directory, name));
    }
  }

  return files.sort();
}
