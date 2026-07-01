import { homedir } from "node:os";
import { join } from "node:path";

/** Default user-level skill directories (scanned on every run). */
export function getDefaultUserSkillDirs(home: string): string[] {
  return [
    join(home, ".claude", "skills"),
    join(home, ".agents", "skills"),
  ];
}

/** Plugin cache root, included when `--all` is passed. */
export function getPluginCacheDir(home: string): string {
  return join(home, ".claude", "plugins", "cache");
}

/** User config file for extra scan paths. */
export function getConfigFilePath(home: string): string {
  return join(home, ".config", "claude-skill-finder", "config.json");
}

export function resolveHome(home?: string): string {
  return home ?? homedir();
}
