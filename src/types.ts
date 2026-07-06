export type SkillSource = "user" | "project" | "plugin" | "custom";

export interface SkillSummary {
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

export interface SkillFile {
  relativePath: string;
  size: number;
}

export interface SkillDetail extends SkillSummary {
  content: string;
  frontmatter: Record<string, string>;
  body: string;
  bodyHtml: string;
  files: SkillFile[];
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
