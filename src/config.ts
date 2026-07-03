import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { getConfigFilePath } from "./paths.ts";

export interface SkillFinderConfig {
  paths?: string[];
}

export async function loadConfig(home: string = homedir()): Promise<SkillFinderConfig> {
  const configPath = getConfigFilePath(home);

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = await Bun.file(configPath).json();
    if (!raw || typeof raw !== "object") {
      return {};
    }

    const config = raw as SkillFinderConfig;
    const paths = config.paths?.filter(
      (path): path is string => typeof path === "string" && path.length > 0,
    );

    return paths ? { paths } : {};
  } catch {
    console.warn(`Warning: failed to parse config at ${configPath}`);
    return {};
  }
}

export function resolveConfigPaths(paths: string[] | undefined, home: string): string[] {
  if (!paths) return [];

  return paths.map((path) => {
    if (path.startsWith("~/")) {
      return resolve(home, path.slice(2));
    }
    return resolve(path);
  });
}
