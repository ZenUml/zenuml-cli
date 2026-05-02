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

Or use OAuth (PKCE + browser callback):

```bash
zenuml auth login-oauth --site https://your-site.atlassian.net
```

The CLI ships with a built-in OAuth app (client ID and secret) — no credentials needed for standard usage.

Optional flags (for advanced/self-hosted use):

```bash
zenuml auth login-oauth \
	--site https://your-site.atlassian.net \
	--timeout-ms 180000
```

Configure your Atlassian OAuth app callback URL to match:

```text
http://127.0.0.1:53682/oauth/callback
```

Credentials are stored in `~/.zenuml-cli.json`. You can also use environment variables:

| Variable | Description |
|---|---|
| `ZENUML_CLI_AUTH_METHOD` | `basic` or `oauth` |
| `ZENUML_CLI_SITE` | Confluence site URL |
| `ZENUML_CLI_EMAIL` | Atlassian account email |
| `ZENUML_CLI_API_TOKEN` | Atlassian API token |
| `ZENUML_CLI_ACCESS_TOKEN` | OAuth access token (advanced/manual override) |
| `ZENUML_CLI_REFRESH_TOKEN` | OAuth refresh token (advanced/manual override) |
| `ZENUML_CLI_EXPIRES_AT` | OAuth access-token expiry timestamp (ms since epoch) |
| `ZENUML_CLI_OAUTH_CLIENT_ID` | Atlassian OAuth client ID |
| `ZENUML_CLI_OAUTH_CLIENT_SECRET` | Atlassian OAuth client secret (optional) |
| `ZENUML_CLI_CLOUD_ID` | Confluence cloud ID (auto-discovered by login-oauth) |
| `ZENUML_CLI_OAUTH_CALLBACK_PORT` | OAuth localhost callback port (default: `53682`) |
| `ZENUML_CLI_ADDON_KEY` | Override addon key (skips auto-detection) |
| `ZENUML_CLI_CONFIG` | Override config file path |

OAuth mode automatically refreshes access tokens using the stored refresh token.

## Commands

### Auth

```bash
zenuml auth login    # Save credentials
zenuml auth login-oauth  # OAuth login via browser
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

The CLI automatically detects which addon variant (full or lite) is installed on your Confluence site by probing for existing ZenUML content. No configuration needed.

If auto-detection isn't suitable, you can override with `--addon-key`:
```bash
zenuml diagram list --addon-key com.zenuml.confluence-addon-lite
```

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
