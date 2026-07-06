import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "./server.ts";
import type { SkillDetail, SkillSummary } from "./types.ts";

interface SkillFileResponse {
  relativePath: string;
  size: number;
  binary: boolean;
  content: string | null;
  contentHtml: string | null;
}

let tempHome: string;
let skillsDir: string;
let baseUrl: string;
let handle: Awaited<ReturnType<typeof createServer>>;

async function getSkillId(name: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/skills`);
  const data = (await res.json()) as { skills: SkillSummary[] };
  const skill = data.skills.find((s) => s.name === name);

  if (!skill) {
    throw new Error(`Skill not found in listing: ${name}`);
  }

  return skill.id;
}

beforeAll(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "skill-finder-server-"));
  skillsDir = join(tempHome, ".claude", "skills");
  const sampleDir = join(skillsDir, "sample");

  await Bun.write(
    join(sampleDir, "SKILL.md"),
    "---\nname: sample-skill\ndescription: Sample skill for server tests.\n---\n\n# Sample\n\nBody text.\n\n<script>alert(1)</script>\n",
  );
  await Bun.write(join(sampleDir, "notes.txt"), "hello notes");
  await Bun.write(join(sampleDir, "refs", "deep.txt"), "deep file");
  await Bun.write(join(sampleDir, "bin.dat"), new Uint8Array([0x89, 0x00, 0x50, 0x4e]));

  // Separate skill dir so the sample-skill file listing stays untouched.
  const guardedDir = join(skillsDir, "guarded");
  await Bun.write(
    join(guardedDir, "SKILL.md"),
    "---\nname: guarded-skill\ndescription: Guards file access.\n---\n\n# Guarded\n",
  );
  await Bun.write(join(tempHome, "secret.txt"), "top secret");
  await Bun.write(join(tempHome, "outside", "secret.txt"), "outside secret");
  await Bun.write(join(guardedDir, "real.txt"), "real file");
  await Bun.write(join(guardedDir, "doc.md"), "# Doc\n\n**bold** text\n");
  await symlink(join(tempHome, "secret.txt"), join(guardedDir, "leak.txt"), "file");
  await symlink(join(tempHome, "outside"), join(guardedDir, "outdir"), "dir");
  await symlink(join(guardedDir, "real.txt"), join(guardedDir, "alias.txt"), "file");
  await Bun.write(join(guardedDir, "huge.txt"), "x".repeat(2 * 1024 * 1024 + 1));

  const lateNul = new Uint8Array(9000).fill(0x80);
  lateNul[8500] = 0x00;
  await Bun.write(join(guardedDir, "late-nul.bin"), lateNul);

  handle = await createServer({
    host: "127.0.0.1",
    port: 0,
    home: tempHome,
    cwd: tempHome,
  });
  baseUrl = `http://127.0.0.1:${handle.server.port}`;
});

afterAll(async () => {
  await handle.stop();
  await rm(tempHome, { recursive: true, force: true });
});

describe("GET /api/skills", () => {
  test("returns summaries with warnings and token estimates", async () => {
    const res = await fetch(`${baseUrl}/api/skills`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as { skills: SkillSummary[] };
    const skill = data.skills.find((s) => s.name === "sample-skill");

    expect(skill).toBeDefined();
    expect(skill!.warnings).toEqual([]);
    expect(skill!.descriptionTokens).toBe(Math.ceil("Sample skill for server tests.".length / 4));
    expect(skill!.bodyTokens).toBeGreaterThan(0);
  });
});

describe("GET /api/skills/:id", () => {
  test("returns a recursive file listing without SKILL.md", async () => {
    const id = await getSkillId("sample-skill");
    const res = await fetch(`${baseUrl}/api/skills/${id}`);
    expect(res.status).toBe(200);

    const detail = (await res.json()) as SkillDetail;
    expect(detail.files).toEqual([
      { relativePath: "bin.dat", size: 4 },
      { relativePath: "notes.txt", size: 11 },
      { relativePath: "refs/deep.txt", size: 9 },
    ]);
    expect(detail.body).toContain("# Sample");
  });

  test("renders the body to HTML with raw HTML escaped", async () => {
    const id = await getSkillId("sample-skill");
    const res = await fetch(`${baseUrl}/api/skills/${id}`);
    expect(res.status).toBe(200);

    const detail = (await res.json()) as SkillDetail;
    expect(detail.bodyHtml).toContain("<h1>Sample</h1>");
    expect(detail.bodyHtml).not.toContain("<script>");
  });

  test("returns 404 for an unknown skill", async () => {
    const res = await fetch(`${baseUrl}/api/skills/unknown-id`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Skill not found" });
  });
});

describe("GET /api/skills/:id/file", () => {
  test("returns text file content", async () => {
    const id = await getSkillId("sample-skill");
    const res = await fetch(`${baseUrl}/api/skills/${id}/file?path=notes.txt`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as SkillFileResponse;
    expect(data).toEqual({
      relativePath: "notes.txt",
      size: 11,
      binary: false,
      content: "hello notes",
      contentHtml: null,
    });
  });

  test("renders markdown files to HTML", async () => {
    const id = await getSkillId("guarded-skill");
    const res = await fetch(`${baseUrl}/api/skills/${id}/file?path=doc.md`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as SkillFileResponse;
    expect(data.contentHtml).toContain("<h1>Doc</h1>");
    expect(data.contentHtml).toContain("<strong>bold</strong>");
  });

  test("returns nested file content", async () => {
    const id = await getSkillId("sample-skill");
    const res = await fetch(`${baseUrl}/api/skills/${id}/file?path=refs/deep.txt`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as SkillFileResponse;
    expect(data.content).toBe("deep file");
    expect(data.binary).toBe(false);
  });

  test("detects binary files", async () => {
    const id = await getSkillId("sample-skill");
    const res = await fetch(`${baseUrl}/api/skills/${id}/file?path=bin.dat`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as SkillFileResponse;
    expect(data).toEqual({
      relativePath: "bin.dat",
      size: 4,
      binary: true,
      content: null,
      contentHtml: null,
    });
  });

  test("rejects a missing path parameter", async () => {
    const id = await getSkillId("sample-skill");
    const res = await fetch(`${baseUrl}/api/skills/${id}/file`);
    expect(res.status).toBe(400);
  });

  test("rejects traversal outside the skill directory", async () => {
    const id = await getSkillId("sample-skill");
    const res = await fetch(
      `${baseUrl}/api/skills/${id}/file?path=${encodeURIComponent("../../etc/hosts")}`,
    );
    expect(res.status).toBe(400);
  });

  test("rejects absolute paths", async () => {
    const id = await getSkillId("sample-skill");
    const res = await fetch(
      `${baseUrl}/api/skills/${id}/file?path=${encodeURIComponent("/etc/hosts")}`,
    );
    expect(res.status).toBe(400);
  });

  test("rejects a file symlink that points outside the skill directory", async () => {
    const id = await getSkillId("guarded-skill");
    const res = await fetch(`${baseUrl}/api/skills/${id}/file?path=leak.txt`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Path escapes the skill directory" });
  });

  test("rejects a path through a directory symlink that points outside", async () => {
    const id = await getSkillId("guarded-skill");
    const res = await fetch(
      `${baseUrl}/api/skills/${id}/file?path=${encodeURIComponent("outdir/secret.txt")}`,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Path escapes the skill directory" });
  });

  test("serves a symlink that stays inside the skill directory", async () => {
    const id = await getSkillId("guarded-skill");
    const res = await fetch(`${baseUrl}/api/skills/${id}/file?path=alias.txt`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as SkillFileResponse;
    expect(data.content).toBe("real file");
  });

  test("rejects files above the size limit", async () => {
    const id = await getSkillId("guarded-skill");
    const res = await fetch(`${baseUrl}/api/skills/${id}/file?path=huge.txt`);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: `File too large (${2 * 1024 * 1024 + 1} bytes)`,
    });
  });

  test("detects binary files whose first NUL byte sits beyond 8KB", async () => {
    const id = await getSkillId("guarded-skill");
    const res = await fetch(`${baseUrl}/api/skills/${id}/file?path=late-nul.bin`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as SkillFileResponse;
    expect(data.binary).toBe(true);
    expect(data.content).toBeNull();
  });

  test("returns 404 for a missing file", async () => {
    const id = await getSkillId("sample-skill");
    const res = await fetch(`${baseUrl}/api/skills/${id}/file?path=missing.txt`);
    expect(res.status).toBe(404);
  });

  test("returns 404 for an unknown skill", async () => {
    const res = await fetch(`${baseUrl}/api/skills/unknown-id/file?path=notes.txt`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/rescan and GET /api/events", () => {
  test("responds with text/event-stream", async () => {
    // Abort via AbortController: cancelling the body reader of a streamed
    // fetch response can leave the connection dangling and block stop().
    const abort = new AbortController();
    const res = await fetch(`${baseUrl}/api/events`, { signal: abort.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toStartWith("text/event-stream");
    abort.abort();
  });

  test("rescan picks up a new skill and broadcasts an SSE event", async () => {
    const abort = new AbortController();
    const eventsRes = await fetch(`${baseUrl}/api/events`, {
      signal: abort.signal,
    });
    const reader = eventsRes.body!.getReader();
    const decoder = new TextDecoder();

    await Bun.write(
      join(skillsDir, "added", "SKILL.md"),
      "---\nname: added-skill\ndescription: Added after startup.\n---\n\n# Added\n",
    );

    const rescanRes = await fetch(`${baseUrl}/api/rescan`, { method: "POST" });
    expect(rescanRes.status).toBe(200);

    const rescanData = (await rescanRes.json()) as { skills: SkillSummary[] };
    expect(rescanData.skills.some((s) => s.name === "added-skill")).toBe(true);

    const listRes = await fetch(`${baseUrl}/api/skills`);
    const listData = (await listRes.json()) as { skills: SkillSummary[] };
    expect(listData.skills.some((s) => s.name === "added-skill")).toBe(true);

    let received = "";
    const deadline = Date.now() + 3000;
    while (!received.includes("skills-changed") && Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolveTimeout) => {
          setTimeout(
            () => resolveTimeout({ done: true, value: undefined }),
            Math.max(deadline - Date.now(), 1),
          );
        }),
      ]);
      if (chunk.done) break;
      received += decoder.decode(chunk.value, { stream: true });
    }

    abort.abort();
    expect(received).toContain('data: {"type":"skills-changed"}');
  });
});
