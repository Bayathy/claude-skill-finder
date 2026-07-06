# Claude Skill Finder

Browse installed Claude skills (`SKILL.md`) in a local Web UI.

## Features

- Search and filter skills by name, description, path, and source (user / project / plugin / custom)
- Live reload: skill directories are watched and the UI refreshes automatically; a Reload button triggers a manual rescan
- Lint warnings per skill (missing frontmatter, missing or non-kebab-case name, missing or overlong description, empty body, duplicate names)
- Token estimates for each skill's description and full `SKILL.md` content
- In-UI viewer for auxiliary files inside a skill directory (markdown rendered, text shown as code, binary files detected and skipped)

## Quick start

Requires Bun 1.3.14+ (markdown is rendered with `Bun.markdown`).

From this repository:

```bash
bun install
bun run start
```

Or during development with hot reload:

```bash
bun run dev
```

The CLI scans skills, starts a local server, and opens your browser.

## Global local install

```bash
bun link
bunx claude-skill-finder
```

After `bun link`, you can use `bunx claude-skill-finder` from anywhere on your machine.

## CLI options

| Flag               | Description                               | Default           |
| ------------------ | ----------------------------------------- | ----------------- |
| `--port <number>`  | Port to listen on                         | `3847`            |
| `--host <address>` | Host to bind                              | `127.0.0.1`       |
| `--open`           | Open browser on start                     | on                |
| `--no-open`        | Do not open browser                       |                   |
| `--all`            | Include plugin cache skills               | off               |
| `--path <dir>`     | Additional directory to scan (repeatable) |                   |
| `--cwd <dir>`      | Project skill search root                 | current directory |

Examples:

```bash
bun run start --all
bun run start --path ~/my-skills
bun run start --port 3456 --no-open
```

## Scan targets

By default:

- `~/.claude/skills/**/SKILL.md`
- `~/.agents/skills/**/SKILL.md`
- `.claude/skills/**/SKILL.md` from the current directory upward

With `--all`:

- `~/.claude/plugins/cache/**/SKILL.md`

With `--path`:

- Any extra directories you provide on the command line

### Config file

You can add persistent scan paths in:

`~/.config/claude-skill-finder/config.json`

```json
{
  "paths": ["~/my-skills", "/absolute/path/to/skills"]
}
```

Paths from the config file are merged with the defaults. CLI `--path` flags are applied on top.

Symlinked skills are deduplicated by their real path.

## API

- `GET /api/skills` — list skill summaries (including warnings and token estimates)
- `GET /api/skills/:id` — skill detail with markdown body and auxiliary file listing (`{ relativePath, size }`)
- `GET /api/skills/:id/file?path=<relativePath>` — read an auxiliary file; binary files return `binary: true` with `content: null`; paths outside the skill directory (including via symlinks) are rejected; files larger than 2 MB return `413`
- `POST /api/rescan` — rescan all roots and return the fresh skill list
- `GET /api/events` — Server-Sent Events stream; emits `{"type":"skills-changed"}` whenever the skill set changes (filesystem watcher or rescan)

## Development

```bash
bun test             # run tests
bun run lint         # oxlint
bun run lint:fix     # oxlint with autofix
bun run format       # oxfmt (write)
bun run format:check # oxfmt (check only)
bun run typecheck    # tsc for src/ and public/
```

All of these run in CI (GitHub Actions) on pushes and pull requests to `main`.

## Publishing

This package is currently local-only. After publishing to npm, you will be able to run:

```bash
bunx claude-skill-finder
```
