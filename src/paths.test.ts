import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { resolveConfigPaths } from "../src/config.ts";
import { getDefaultUserSkillDirs, getPluginCacheDir } from "../src/paths.ts";

const HOME = "/home/demo";

describe("default paths", () => {
  test("includes claude and agents skill directories", () => {
    expect(getDefaultUserSkillDirs(HOME)).toEqual([
      join(HOME, ".claude", "skills"),
      join(HOME, ".agents", "skills"),
    ]);
  });

  test("resolves plugin cache directory", () => {
    expect(getPluginCacheDir(HOME)).toBe(join(HOME, ".claude", "plugins", "cache"));
  });
});

describe("resolveConfigPaths", () => {
  test("expands home-relative paths", () => {
    expect(resolveConfigPaths(["~/skills/extra"], HOME)).toEqual([join(HOME, "skills", "extra")]);
  });
});
