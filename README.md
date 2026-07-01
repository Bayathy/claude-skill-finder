# Claude Skill Finder

Browse installed Claude skills (`SKILL.md`) in a local Web UI.

## Quick start

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

| Flag | Description | Default |
|------|-------------|---------|
| `--port <number>` | Port to listen on | `3847` |
| `--host <address>` | Host to bind | `127.0.0.1` |
| `--open` | Open browser on start | on |
| `--no-open` | Do not open browser | |
| `--all` | Include plugin cache skills | off |
| `--path <dir>` | Additional directory to scan (repeatable) | |
| `--cwd <dir>` | Project skill search root | current directory |

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
  "paths": [
    "~/my-skills",
    "/absolute/path/to/skills"
  ]
}
```

Paths from the config file are merged with the defaults. CLI `--path` flags are applied on top.

Symlinked skills are deduplicated by their real path.

## API

- `GET /api/skills` — list skill summaries
- `GET /api/skills/:id` — skill detail with markdown body and auxiliary files

## Tests

```bash
bun test
```

## Publishing

This package is currently local-only. After publishing to npm, you will be able to run:

```bash
bunx claude-skill-finder
```
