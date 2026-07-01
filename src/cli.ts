#!/usr/bin/env bun
import { homedir } from "node:os";
import { loadConfig, resolveConfigPaths } from "./config.ts";
import { getConfigFilePath } from "./paths.ts";
import { createServer } from "./server.ts";
import { buildScanRoots } from "./skill-scanner.ts";
import type { CliOptions } from "./types.ts";

const DEFAULT_PORT = 3847;

function printHelp(): void {
  console.log(`claude-skill-finder — Browse Claude skills in a local Web UI

Usage:
  bunx claude-skill-finder [options]

Options:
  --port <number>    Port to listen on (default: ${DEFAULT_PORT})
  --host <address>   Host to bind (default: 127.0.0.1)
  --open             Open browser on start (default)
  --no-open          Do not open browser
  --all              Include plugin cache skills
  --path <dir>       Additional directory to scan (repeatable)
  --cwd <dir>        Project skill search root (default: cwd)
  -h, --help         Show this help

Default scan paths:
  ~/.claude/skills
  ~/.agents/skills
  .claude/skills (from cwd upward)

Extra paths can be added in ~/.config/claude-skill-finder/config.json
`);
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    port: DEFAULT_PORT,
    host: "127.0.0.1",
    open: true,
    all: false,
    paths: [],
    cwd: process.cwd(),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    switch (arg) {
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
        break;
      case "--port": {
        const value = argv[++i];
        if (!value) throw new Error("--port requires a value");
        options.port = Number(value);
        if (!Number.isInteger(options.port) || options.port < 1) {
          throw new Error("--port must be a positive integer");
        }
        break;
      }
      case "--host": {
        const value = argv[++i];
        if (!value) throw new Error("--host requires a value");
        options.host = value;
        break;
      }
      case "--open":
        options.open = true;
        break;
      case "--no-open":
        options.open = false;
        break;
      case "--all":
        options.all = true;
        break;
      case "--path": {
        const value = argv[++i];
        if (!value) throw new Error("--path requires a value");
        options.paths.push(value);
        break;
      }
      case "--cwd": {
        const value = argv[++i];
        if (!value) throw new Error("--cwd requires a value");
        options.cwd = value;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function findAvailablePort(
  host: string,
  startPort: number,
): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    try {
      const probe = Bun.serve({
        hostname: host,
        port,
        fetch: () => new Response(""),
      });
      await probe.stop(true);
      return port;
    } catch {
      continue;
    }
  }

  throw new Error(`No available port found near ${startPort}`);
}

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;

  try {
    if (platform === "darwin") {
      await Bun.$`open ${url}`.quiet();
    } else if (platform === "win32") {
      await Bun.$`cmd /c start ${url}`.quiet();
    } else {
      await Bun.$`xdg-open ${url}`.quiet();
    }
  } catch {
    console.log(`Open this URL in your browser: ${url}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const port = await findAvailablePort(options.host, options.port);

  const home = homedir();
  const config = await loadConfig(home);
  const configPaths = resolveConfigPaths(config.paths, home);
  const scanPaths = [...configPaths, ...options.paths];

  const { roots } = await buildScanRoots({
    all: options.all,
    paths: scanPaths,
    cwd: options.cwd,
  });

  const { server, skills } = await createServer({
    host: options.host,
    port,
    all: options.all,
    paths: scanPaths,
    cwd: options.cwd,
  });

  const url = `http://${options.host}:${server.port}`;

  console.log("Scanning:");
  for (const root of roots) {
    console.log(`  ${root}`);
  }
  if (configPaths.length > 0) {
    console.log(`Config: ${getConfigFilePath(home)}`);
  }
  console.log(`Found ${skills.length} skill(s)`);
  console.log(`Listening on ${url}`);
  console.log("Press Ctrl+C to stop");

  if (options.open) {
    await openBrowser(url);
  }

  process.on("SIGINT", () => {
    server.stop(true);
    process.exit(0);
  });

  await new Promise(() => {});
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
