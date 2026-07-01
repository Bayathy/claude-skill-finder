import index from "../public/index.html";
import {
  listDirectoryFiles,
  parseFrontmatter,
  scanSkills,
} from "./skill-scanner.ts";
import type { ScanOptions, SkillDetail, SkillSummary } from "./types.ts";

export interface ServerOptions extends ScanOptions {
  host: string;
  port: number;
}

export async function createServer(options: ServerOptions) {
  const skills = await scanSkills(options);
  const skillMap = new Map<string, SkillSummary>(
    skills.map((skill) => [skill.id, skill]),
  );

  async function getSkillDetail(id: string): Promise<Response> {
    const summary = skillMap.get(id);

    if (!summary) {
      return Response.json({ error: "Skill not found" }, { status: 404 });
    }

    const content = await Bun.file(summary.path).text();
    const { frontmatter, body } = parseFrontmatter(content);
    const files = await listDirectoryFiles(summary.directory);

    const detail: SkillDetail = {
      ...summary,
      content,
      frontmatter,
      body,
      files,
    };

    return Response.json(detail);
  }

  const server = Bun.serve({
    hostname: options.host,
    port: options.port,
    routes: {
      "/": index,
      "/api/skills": {
        GET: () => Response.json({ skills }),
      },
      "/api/skills/:id": {
        GET: (req) => getSkillDetail(req.params.id),
      },
    },
    development: {
      hmr: true,
      console: true,
    },
    async fetch(req) {
      const url = new URL(req.url);

      // Bun HTML routes handle "/" — keep a fallback for unmatched paths.
      if (url.pathname.startsWith("/api/")) {
        return new Response("Not found", { status: 404 });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  return { server, skills };
}
