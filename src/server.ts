import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import index from "../public/index.html";
import {
  buildScanRoots,
  listDirectoryFiles,
  parseFrontmatter,
  scanSkills,
} from "./skill-scanner.ts";
import type { ScanOptions, SkillDetail, SkillSummary } from "./types.ts";

export interface ServerOptions extends ScanOptions {
  host: string;
  port: number;
}

export interface SkillFinderServer {
  server: ReturnType<typeof Bun.serve>;
  skills: SkillSummary[];
  stop: () => Promise<void>;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const WATCH_DEBOUNCE_MS = 300;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** True when `child` is `parent` itself or nested beneath it. */
function isPathInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent + sep);
}

export async function createServer(options: ServerOptions): Promise<SkillFinderServer> {
  const skills = await scanSkills(options);
  let skillMap = new Map<string, SkillSummary>(skills.map((skill) => [skill.id, skill]));

  const encoder = new TextEncoder();
  const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  function sendToClients(payload: Uint8Array): void {
    for (const controller of sseClients) {
      try {
        controller.enqueue(payload);
      } catch {
        sseClients.delete(controller);
      }
    }
  }

  const heartbeat = setInterval(() => {
    sendToClients(encoder.encode(": ping\n\n"));
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  async function rescan(): Promise<void> {
    const next = await scanSkills(options);
    skills.splice(0, skills.length, ...next);
    skillMap = new Map(skills.map((skill) => [skill.id, skill]));
    sendToClients(encoder.encode('data: {"type":"skills-changed"}\n\n'));
  }

  const { roots } = await buildScanRoots(options);
  const watchers: FSWatcher[] = [];
  let rescanTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleRescan(): void {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => {
      rescan().catch((error: unknown) => {
        console.error("Rescan failed:", error);
      });
    }, WATCH_DEBOUNCE_MS);
  }

  for (const root of roots) {
    try {
      watchers.push(watch(root, { recursive: true }, scheduleRescan));
    } catch {
      try {
        watchers.push(watch(root, scheduleRescan));
      } catch {
        // Root disappeared or cannot be watched — skip it.
      }
    }
  }

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

  async function getSkillFile(id: string, req: Request): Promise<Response> {
    const summary = skillMap.get(id);

    if (!summary) {
      return Response.json({ error: "Skill not found" }, { status: 404 });
    }

    const relativePath = new URL(req.url).searchParams.get("path");
    if (!relativePath) {
      return Response.json({ error: "Missing 'path' query parameter" }, { status: 400 });
    }
    if (isAbsolute(relativePath)) {
      return Response.json(
        { error: "Path must be relative to the skill directory" },
        { status: 400 },
      );
    }
    if (relativePath.split(/[/\\]/).includes("..")) {
      return Response.json({ error: "Path escapes the skill directory" }, { status: 400 });
    }

    const directory = resolve(summary.directory);
    const resolved = resolve(directory, relativePath);
    if (!isPathInside(directory, resolved)) {
      return Response.json({ error: "Path escapes the skill directory" }, { status: 400 });
    }

    // The lexical check above never follows symlinks, so a link inside the
    // skill directory could point anywhere. Compare real paths (against the
    // skill directory's OWN real path, so legitimately symlinked skills work).
    let realResolved: string;
    let realDirectory: string;
    try {
      [realResolved, realDirectory] = await Promise.all([realpath(resolved), realpath(directory)]);
    } catch {
      return Response.json({ error: "File not found" }, { status: 404 });
    }
    if (!isPathInside(realDirectory, realResolved)) {
      return Response.json({ error: "Path escapes the skill directory" }, { status: 400 });
    }

    let size: number;
    try {
      const info = await stat(realResolved);
      if (!info.isFile()) {
        return Response.json({ error: "File not found" }, { status: 404 });
      }
      size = info.size;
    } catch {
      return Response.json({ error: "File not found" }, { status: 404 });
    }

    if (size > MAX_FILE_BYTES) {
      return Response.json({ error: `File too large (${size} bytes)` }, { status: 413 });
    }

    // NUL-sniff the WHOLE file, not just an 8KB head: a binary file whose
    // first NUL sits past the window would otherwise be lossily decoded as
    // UTF-8 garbage. The 2MB cap above keeps the full scan cheap.
    const bytes = new Uint8Array(await Bun.file(realResolved).arrayBuffer());
    const binary = bytes.includes(0);

    return Response.json({
      relativePath,
      size,
      binary,
      content: binary ? null : new TextDecoder().decode(bytes),
    });
  }

  function createEventStream(req: Request): Response {
    let clientController: ReadableStreamDefaultController<Uint8Array> | undefined;

    function removeClient(): void {
      if (!clientController) return;
      sseClients.delete(clientController);
      try {
        clientController.close();
      } catch {
        // Stream already closed or cancelled.
      }
      clientController = undefined;
    }

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        clientController = controller;
        sseClients.add(controller);
        controller.enqueue(encoder.encode(": connected\n\n"));
      },
      cancel: () => {
        removeClient();
      },
    });

    req.signal.addEventListener("abort", removeClient);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
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
      "/api/skills/:id/file": {
        GET: (req) => getSkillFile(req.params.id, req),
      },
      "/api/rescan": {
        POST: async () => {
          await rescan();
          return Response.json({ skills });
        },
      },
      "/api/events": {
        GET: (req, activeServer) => {
          // SSE streams must outlive Bun's default 10s idleTimeout.
          activeServer.timeout(req, 0);
          return createEventStream(req);
        },
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

  async function stop(): Promise<void> {
    clearTimeout(rescanTimer);
    clearInterval(heartbeat);

    for (const watcher of watchers) {
      watcher.close();
    }

    for (const controller of sseClients) {
      try {
        controller.close();
      } catch {
        // Stream already closed by the client.
      }
    }
    sseClients.clear();

    await server.stop(true);
  }

  return { server, skills, stop };
}
