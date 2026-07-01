export type SkillSource = "user" | "project" | "plugin" | "custom";

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  path: string;
  realPath: string;
  source: SkillSource;
  directory: string;
}

export interface SkillDetail extends SkillSummary {
  content: string;
  frontmatter: Record<string, string>;
  body: string;
  files: string[];
}

export interface ScanOptions {
  all?: boolean;
  paths?: string[];
  cwd?: string;
  home?: string;
}

export interface CliOptions {
  port: number;
  host: string;
  open: boolean;
  all: boolean;
  paths: string[];
  cwd: string;
}
