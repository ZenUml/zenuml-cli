# @zenuml/confluence-cli

CLI for managing ZenUML diagrams stored in Confluence Cloud.

## Installation

```bash
npm install -g @zenuml/confluence-cli
```

Or run directly with `npx`:

```bash
npx @zenuml/confluence-cli auth whoami --site https://your-site.atlassian.net --email you@example.com --api-token YOUR_TOKEN
```

## Authentication

Save credentials locally so you don't have to pass them every time:

```bash
zenuml auth login --site https://your-site.atlassian.net --email you@example.com --api-token YOUR_TOKEN
```

Credentials are stored in `~/.zenuml-cli.json`. You can also use environment variables:

| Variable | Description |
|---|---|
| `ZENUML_CLI_SITE` | Confluence site URL |
| `ZENUML_CLI_EMAIL` | Atlassian account email |
| `ZENUML_CLI_API_TOKEN` | Atlassian API token |
| `ZENUML_CLI_VARIANT` | Addon variant (`full`, `lite`, or `auto`) |
| `ZENUML_CLI_ADDON_KEY` | Override addon key |
| `ZENUML_CLI_CONFIG` | Override config file path |

## Commands

### Auth

```bash
zenuml auth login    # Save credentials
zenuml auth whoami   # Test authentication
zenuml auth logout   # Clear stored credentials
```

### Diagrams

```bash
# List diagrams
zenuml diagram list [--space <key>] [--page <id>] [--type <type>] [--limit <n>] [--format json|text]

# Get a diagram
zenuml diagram get <id> [--format json|text]

# Create a diagram
zenuml diagram create --page <pageId> --type <type> [--title <title>] (--file <path> | --stdin)

# Update a diagram
zenuml diagram update <id> [--type <type>] [--title <title>] (--file <path> | --stdin)

# Delete a diagram
zenuml diagram delete <id> [--force]

# Export raw diagram content
zenuml diagram export <id> [--format raw|json] [--output <path>]
```

### Diagram Types

`sequence`, `mermaid`, `plantuml`, `graph` (Draw.io), `openapi`

### Variants

The CLI automatically detects which addon variant is installed on your Confluence site.
You can also set it explicitly via `--variant`:

- `auto` (default) — auto-detects by probing the site for existing content
- `full` — `com.zenuml.confluence-addon`
- `lite` — `com.zenuml.confluence-addon-lite`

When using `auto`, the CLI checks for existing ZenUML content under each addon key and uses the first match. If no content exists, it defaults to `full`.

## Development

```bash
pnpm install
pnpm build
pnpm test
```

### Live testing

```bash
bash scripts/test-live.sh
```

See [docs/live-verification-whimet4.md](docs/live-verification-whimet4.md) for details.

## License

MIT
