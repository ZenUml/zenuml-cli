# CLI Live Verification Report - `whimet4.atlassian.net`

## Purpose

This report captures the live, non-destructive verification of the Confluence CLI against the `whimet4.atlassian.net` tenant. It validates the MVP read flows described in `plan.md` for a real Atlassian site using stored local credentials.

## Test Environment

- **Date**: 2026-03-28
- **Target site**: `https://whimet4.atlassian.net`
- **CLI package**: `cli/`
- **Credential source**: `~/.atlassian_auth.json`
- **Verification scope**: authentication and read-only diagram operations
- **Out of scope**: `diagram create`, `diagram update`, and `diagram delete`

## Preconditions

- `pnpm build:cli` completed successfully before the live checks.
- Credentials were loaded from `~/.atlassian_auth.json` into environment variables for the session only.
- Temporary shell exports were removed after verification.

## Commands Executed

The following commands were executed from the repository root:

```bash
pnpm build:cli

node cli/dist/index.js auth whoami

node cli/dist/index.js diagram list --variant full --format json --limit 5
node cli/dist/index.js diagram list --variant lite --format json --limit 5
node cli/dist/index.js diagram list --variant full --addon-key gptdock-confluence --format json --limit 5

node cli/dist/index.js diagram get 429981697 --variant lite --format json
node cli/dist/index.js diagram export 429981697 --variant lite --format raw
node cli/dist/index.js diagram list --variant lite --page 428310556 --format json --limit 3
```

## Results

### 1. Authentication

- `auth whoami` succeeded.
- The API returned the current Atlassian user profile for the configured account.
- This confirms:
  - credential parsing from `~/.atlassian_auth.json`
  - CLI config resolution in `cli/src/config.ts`
  - authenticated Confluence REST access through `ConfluenceClient.whoAmI()` in `cli/src/confluenceClient.ts`

### 2. Variant Detection by Live Data

#### `--variant full`

- `diagram list --variant full --format json --limit 5` returned `[]`.
- No matching custom content was found for the default full addon key on this tenant.

#### `--variant lite`

- `diagram list --variant lite --format json --limit 5` returned multiple real records.
- Returned items included both:
  - `ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence`
  - `ac:com.zenuml.confluence-addon-lite:zenuml-content-graph`

This verifies that the tenant currently contains ZenUML custom content under the **lite** addon namespace.

#### `--addon-key gptdock-confluence`

- `diagram list --variant full --addon-key gptdock-confluence --format json --limit 5` failed with:

```text
400 Bad Request: Invalid content type: ac:gptdock-confluence:zenuml-content-sequence
```

This indicates the Diagramly-style addon key is not valid for the tested custom-content types on this tenant.

### 3. Direct Record Retrieval

- `diagram get 429981697 --variant lite --format json` succeeded.
- The returned record contained:
  - custom-content metadata (`id`, `type`, `spaceId`, `pageId`, `version`)
  - raw body content
  - parsed `value.diagramType`

The tested record was:

- **ID**: `429981697`
- **Type**: `ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence`
- **Title**: `Order Service (Demonstration only)`
- **Page ID**: `428310556`

This validates `ConfluenceClient.getDiagram()` and the raw-body parsing path in `cli/src/confluenceClient.ts`.

### 4. Raw Export

- `diagram export 429981697 --variant lite --format raw` succeeded.
- The CLI emitted the diagram source text rather than JSON.
- The exported content matched the expected sequence-diagram source for the selected record.

This validates the export path in `cli/src/index.ts` and content extraction in `cli/src/diagram.ts`.

### 5. Page-Scoped Listing

- `diagram list --variant lite --page 428310556 --format json --limit 3` succeeded.
- The response included the expected lite sequence diagram attached to that page.

This validates page filtering and the page-scoped custom-content list path built by `ConfluenceClient.buildListPath()`.

## Verification Summary

### Passed

- CLI build
- Authenticated `whoami`
- Tenant access using stored credentials
- Lite variant list query
- Lite variant record retrieval
- Lite variant raw export
- Lite variant page-filtered listing

### Observed Site-Specific Behavior

- The `whimet4.atlassian.net` tenant currently appears to use the **lite** addon namespace for persisted ZenUML custom content.
- The default **full** addon key returned no records in this test.
- The `gptdock-confluence` addon key is not accepted for the tested custom-content type on this tenant.

## Conclusion

The CLI MVP live verification succeeded for **read-only flows** on `whimet4.atlassian.net`, with the important caveat that this tenant is currently aligned with the **lite** variant rather than the default full variant.

For this tenant, the CLI should be used with `--variant lite` unless local config is updated to default to the lite namespace.

## Follow-Up Recommendations

1. Add a short troubleshooting note to CLI user documentation explaining that empty list results may indicate the wrong variant/addon key rather than an auth failure.
2. Consider improving variant discovery in the CLI so it can suggest `lite` automatically when `full` returns no records and `lite` succeeds.
3. If write-path verification is required later, run a separate controlled test for `diagram create`, `diagram update`, and cleanup via `diagram delete` on a disposable page.
