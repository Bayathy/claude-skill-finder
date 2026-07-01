import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  classifySource,
  parseFrontmatter,
  scanSkills,
} from "../src/skill-scanner.ts";

const FIXTURES = join(import.meta.dir, "..", "test", "fixtures");
const FAKE_HOME = join(FIXTURES, "fake-home");
const PROJECT_ROOT = join(FIXTURES, "project-root");
const USER_SKILLS = join(FAKE_HOME, ".claude", "skills");
const SYMLINK_TARGET = join(USER_SKILLS, "beta");

beforeAll(async () => {
  await mkdir(USER_SKILLS, { recursive: true });
  try {
    await symlink(
      join(FIXTURES, "shared-skills", "beta"),
      SYMLINK_TARGET,
      "dir",
    );
  } catch {
    // Symlink may already exist from a previous run.
  }
});

afterAll(async () => {
  try {
    await Bun.$`rm -f ${SYMLINK_TARGET}`.quiet();
  } catch {
    // Ignore cleanup errors in test teardown.
  }
});

describe("parseFrontmatter", () => {
  test("extracts name and description", () => {
    const content = `---
name: test-skill
description: A helpful test skill.
---

# Body`;

    const { frontmatter, body } = parseFrontmatter(content);

    expect(frontmatter.name).toBe("test-skill");
    expect(frontmatter.description).toBe("A helpful test skill.");
    expect(body.trim()).toBe("# Body");
  });

  test("returns original content when frontmatter is missing", () => {
    const content = "# Plain markdown";
    const { frontmatter, body } = parseFrontmatter(content);

    expect(frontmatter).toEqual({});
    expect(body).toBe(content);
  });
});

describe("classifySource", () => {
  const home = FAKE_HOME;
  const customRoots = [join(FIXTURES, "custom-skills")];

  test("labels user skills", () => {
    const path = join(home, ".claude", "skills", "alpha", "SKILL.md");
    expect(classifySource(path, home, customRoots)).toBe("user");
  });

  test("labels plugin skills", () => {
    const path = join(
      home,
      ".claude",
      "plugins",
      "cache",
      "demo-plugin",
      "skills",
      "plugin-skill",
      "SKILL.md",
    );
    expect(classifySource(path, home, customRoots)).toBe("plugin");
  });

  test("labels project skills", () => {
    const path = join(
      PROJECT_ROOT,
      ".claude",
      "skills",
      "project-skill",
      "SKILL.md",
    );
    expect(classifySource(path, home, customRoots)).toBe("project");
  });

  test("labels user skills under ~/.agents/skills", () => {
    const path = join(home, ".agents", "skills", "shadcn", "SKILL.md");
    expect(classifySource(path, home, customRoots)).toBe("user");
  });

  test("labels custom paths", () => {
    const path = join(FIXTURES, "custom-skills", "extra", "SKILL.md");
    expect(classifySource(path, home, customRoots)).toBe("custom");
  });
});

describe("scanSkills", () => {
  test("deduplicates symlinked skills", async () => {
    const skills = await scanSkills({
      home: FAKE_HOME,
      cwd: PROJECT_ROOT,
      paths: [
        join(FIXTURES, "user-skills"),
        join(FIXTURES, "shared-skills"),
      ],
    });

    const betaSkills = skills.filter((skill) => skill.name === "fixture-beta");
    expect(betaSkills).toHaveLength(1);
  });

  test("includes plugin skills only when --all is enabled", async () => {
    const withoutAll = await scanSkills({ home: FAKE_HOME, cwd: PROJECT_ROOT });
    const withAll = await scanSkills({
      home: FAKE_HOME,
      cwd: PROJECT_ROOT,
      all: true,
    });

    expect(withoutAll.some((skill) => skill.name === "fixture-plugin")).toBe(
      false,
    );
    expect(withAll.some((skill) => skill.name === "fixture-plugin")).toBe(true);
  });
});
