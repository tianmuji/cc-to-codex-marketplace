# cc-to-codex-marketplace

Convert Claude Code plugin marketplaces into Codex-compatible plugin marketplaces.

This is a build-time migration tool. It reads a Claude Code marketplace, fetches each plugin source, and writes generated Codex marketplace artifacts that can be committed to the same repo.

## Why

Teams with an existing Claude Code marketplace often already have:

- `.claude-plugin/marketplace.json`
- `.claude-plugin/plugin.json`
- `.mcp.json`
- `skills/*/SKILL.md`

Codex uses a different marketplace/plugin layout:

- `.agents/plugins/marketplace.json`
- `.codex-plugin/plugin.json`
- `.mcp.json` with `{ "mcpServers": ... }`
- `skills/*/SKILL.md`

This tool bridges those formats while preserving MCP servers and pure skill plugins.

## Features

- Converts Claude marketplace entries into Codex marketplace entries.
- Supports `git-subdir` sources pinned by `sha` or `ref`.
- Supports local sources for tests and monorepos.
- Supports pure skill plugins with no MCP server.
- Wraps Claude-style flat `.mcp.json` into Codex `{ "mcpServers": ... }`.
- Can override MCP servers from `stdio` to streamable HTTP for Codex.
- Supports bearer-token env var and OAuth login metadata for HTTP MCP servers.
- Overrides plugin manifest `name` to match the marketplace entry, fixing common name mismatches.
- Normalizes skill frontmatter to Codex-friendly `name` and `description`.
- Removes Claude/OpenAI agent metadata such as `skills/*/agents/openai.yaml`.
- Works in CI with `GITLAB_TOKEN`, `CI_JOB_TOKEN`, or `GITHUB_TOKEN` for private sources.

## Install

Install from GitHub as a dev dependency:

```bash
npm install -D github:tianmuji/cc-to-codex-marketplace#v0.2.0
```

Use `#main` instead of a version tag if you want to track the latest commit.

## Convert

Run from the marketplace repo root:

```bash
npx cc-to-codex-marketplace convert \
  --input .claude-plugin/marketplace.json \
  --output .agents/plugins/marketplace.json \
  --plugins-dir codex/plugins \
  --overrides codex-overrides.yaml \
  --env test
```

Generated layout:

```text
.agents/plugins/marketplace.json
codex/plugins/<plugin>/.codex-plugin/plugin.json
codex/plugins/<plugin>/.codex-plugin/mcp-auth.json
codex/plugins/<plugin>/.mcp.json
codex/plugins/<plugin>/skills/<skill>/SKILL.md
```

`--overrides` defaults to `codex-overrides.yaml` and is ignored if the file does not exist.
`--env` selects an environment-specific URL from the override file.

## MCP Overrides

Use `codex-overrides.yaml` when the Codex plugin should use different MCP transport or auth than the Claude Code plugin:

```yaml
plugins:
  my-plugin:
    mcpServers:
      my-server:
        transport: streamable_http
        url:
          test: https://mcp-test.example.com/mcp
          prod: https://mcp.example.com/mcp
        auth:
          type: oauth
          scopes:
            - my:read
            - my:write
```

Bearer-token HTTP MCP servers use an environment variable name, not a committed token:

```yaml
plugins:
  my-plugin:
    mcpServers:
      my-server:
        transport: streamable_http
        url: https://mcp.example.com/mcp
        auth:
          type: bearer
          bearerTokenEnvVar: MY_MCP_TOKEN
```

Generated OAuth metadata is written to `.codex-plugin/mcp-auth.json`. Users authenticate with Codex after installation:

```bash
codex mcp login my-server --scopes my:read,my:write
```

The OAuth metadata is intentionally separate from `.mcp.json`: Codex discovers OAuth from the remote MCP server during `codex mcp login`, while the generated metadata gives users and CI a stable place to find the expected scopes.

## Validate

```bash
npx cc-to-codex-marketplace validate \
  --marketplace .agents/plugins/marketplace.json \
  --root .
```

## CI Check

`check` regenerates Codex artifacts, validates them, and fails if generated files differ from the committed files.

```bash
npx cc-to-codex-marketplace check
```

GitLab CI example:

```yaml
validate-codex-marketplace:
  image: node:20
  script:
    - npm ci
    - npm install --no-save github:tianmuji/cc-to-codex-marketplace#v0.2.0
    - npx cc-to-codex-marketplace check --overrides codex-overrides.yaml --env test
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes:
        - .claude-plugin/marketplace.json
        - .agents/**/*
        - codex/**/*
```

## Private Repositories

For GitLab sources:

```bash
GITLAB_TOKEN=... npx cc-to-codex-marketplace convert
```

In GitLab CI, `CI_JOB_TOKEN` is also supported.

For GitHub sources:

```bash
GITHUB_TOKEN=... npx cc-to-codex-marketplace convert
```

## User Install Flow

After generated Codex artifacts are committed, users can install the marketplace from the repo:

```bash
codex plugin marketplace add https://github.com/owner/marketplace-repo --ref main
codex plugin add my-plugin@my-marketplace
```

When the marketplace is updated:

```bash
codex plugin marketplace upgrade
codex plugin remove my-plugin@my-marketplace
codex plugin add my-plugin@my-marketplace
```

## Limitations

- This does not emulate Claude Code runtime behavior.
- It converts marketplace/plugin/skill/MCP structure only.
- Tool names and instructions inside `SKILL.md` may still need human review if they mention Claude-specific APIs.
- Generated artifacts should be reviewed before publishing a public repository.

## Example

This repo includes a local fixture:

```bash
npm run test:fixture
```

It demonstrates both:

- a pure skill plugin
- an MCP-backed plugin converted to streamable HTTP with bearer auth
- an MCP-backed plugin converted to streamable HTTP with OAuth metadata

## License

MIT
