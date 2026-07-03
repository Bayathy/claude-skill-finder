import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  classifySource,
  computeWarnings,
  estimateTokens,
  listDirectoryFiles,
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
    await symlink(join(FIXTURES, "shared-skills", "beta"), SYMLINK_TARGET, "dir");
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

  test("parses literal block scalars (description: |)", () => {
    const content = [
      "---",
      "name: block-skill",
      "description: |",
      "  Line one.",
      "  Use when: it is needed.",
      "license: MIT",
      "---",
      "",
      "# Body",
    ].join("\n");

    const { frontmatter } = parseFrontmatter(content);

    expect(frontmatter.description).toBe("Line one.\nUse when: it is needed.");
    expect(frontmatter.license).toBe("MIT");
    expect(frontmatter["Use when"]).toBeUndefined();
  });

  test("parses folded block scalars (description: >-)", () => {
    const content = [
      "---",
      "name: folded-skill",
      "description: >-",
      "  Folded line one",
      "  and line two.",
      "---",
      "",
      "# Body",
    ].join("\n");

    const { frontmatter } = parseFrontmatter(content);

    expect(frontmatter.description).toBe("Folded line one and line two.");
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
    const path = join(PROJECT_ROOT, ".claude", "skills", "project-skill", "SKILL.md");
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
      paths: [join(FIXTURES, "user-skills"), join(FIXTURES, "shared-skills")],
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

    expect(withoutAll.some((skill) => skill.name === "fixture-plugin")).toBe(false);
    expect(withAll.some((skill) => skill.name === "fixture-plugin")).toBe(true);
  });
});

describe("estimateTokens", () => {
  test("returns 0 for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("rounds up to the next token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("computeWarnings", () => {
  test("flags a missing frontmatter block", () => {
    const warnings = computeWarnings({}, "# Body", false);
    expect(warnings).toContain("No frontmatter block found");
  });

  test("flags a missing name", () => {
    const warnings = computeWarnings({ description: "d" }, "# Body", true);
    expect(warnings).toEqual(["Missing 'name' in frontmatter"]);
  });

  test("flags a non-kebab-case name", () => {
    const warnings = computeWarnings({ name: "My_Skill", description: "d" }, "# Body", true);
    expect(warnings).toEqual(["Skill name is not kebab-case"]);
  });

  test("flags a missing description", () => {
    const warnings = computeWarnings({ name: "ok-name" }, "# Body", true);
    expect(warnings).toEqual(["Missing 'description' in frontmatter"]);
  });

  test("flags an overlong description", () => {
    const description = "x".repeat(1025);
    const warnings = computeWarnings({ name: "ok-name", description }, "# Body", true);
    expect(warnings).toEqual(["Description exceeds 1024 characters (1025)"]);
  });

  test("flags an empty body", () => {
    const warnings = computeWarnings({ name: "ok-name", description: "d" }, "  \n  ", true);
    expect(warnings).toEqual(["Skill body is empty"]);
  });

  test("returns no warnings for a valid skill", () => {
    const warnings = computeWarnings({ name: "ok-name", description: "d" }, "# Body", true);
    expect(warnings).toEqual([]);
  });
});

describe("scanSkills warnings and tokens", () => {
  let tempRoot: string;

  beforeAll(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "skill-finder-scan-"));
    await Bun.write(
      join(tempRoot, "first", "SKILL.md"),
      "---\nname: dup-skill\ndescription: First copy.\n---\n\n# First\n",
    );
    await Bun.write(
      join(tempRoot, "second", "SKILL.md"),
      "---\nname: dup-skill\ndescription: Second copy.\n---\n\n# Second\n",
    );
  });

  afterAll(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("marks duplicate skill names on both skills", async () => {
    const skills = await scanSkills({
      home: tempRoot,
      cwd: tempRoot,
      paths: [tempRoot],
    });

    const duplicates = skills.filter((skill) => skill.name === "dup-skill");
    expect(duplicates).toHaveLength(2);

    const [first, second] = duplicates;
    expect(first!.warnings).toContain(`Duplicate skill name — also defined at ${second!.path}`);
    expect(second!.warnings).toContain(`Duplicate skill name — also defined at ${first!.path}`);
  });

  test("estimates description and body tokens", async () => {
    const skills = await scanSkills({
      home: tempRoot,
      cwd: tempRoot,
      paths: [tempRoot],
    });

    const skill = skills.find((s) => s.description === "First copy.");
    expect(skill).toBeDefined();

    const content = await Bun.file(skill!.path).text();
    expect(skill!.descriptionTokens).toBe(Math.ceil("First copy.".length / 4));
    expect(skill!.bodyTokens).toBe(Math.ceil(content.length / 4));
  });
});

describe("listDirectoryFiles", () => {
  let skillDir: string;

  beforeAll(async () => {
    skillDir = await mkdtemp(join(tmpdir(), "skill-finder-files-"));
    await Bun.write(join(skillDir, "SKILL.md"), "---\nname: files\n---\nBody");
    await Bun.write(join(skillDir, "top.txt"), "12345");
    await Bun.write(join(skillDir, "references", "deep.txt"), "abc");
    await Bun.write(join(skillDir, "references", "SKILL.md"), "nested");
  });

  afterAll(async () => {
    await rm(skillDir, { recursive: true, force: true });
  });

  test("lists nested files with sizes, excluding the root SKILL.md", async () => {
    const files = await listDirectoryFiles(skillDir);

    expect(files).toEqual([
      { relativePath: "references/SKILL.md", size: 6 },
      { relativePath: "references/deep.txt", size: 3 },
      { relativePath: "top.txt", size: 5 },
    ]);
  });
});
