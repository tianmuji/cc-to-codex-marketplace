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
- Overrides plugin manifest `name` to match the marketplace entry, fixing common name mismatches.
- Normalizes skill frontmatter to Codex-friendly `name` and `description`.
- Removes Claude/OpenAI agent metadata such as `skills/*/agents/openai.yaml`.
- Works in CI with `GITLAB_TOKEN`, `CI_JOB_TOKEN`, or `GITHUB_TOKEN` for private sources.

## Install

Use directly from GitHub:

```bash
npx github:tianmuji/cc-to-codex-marketplace convert
```

Or install from GitHub as a dev dependency:

```bash
npm install -D github:tianmuji/cc-to-codex-marketplace
```

## Convert

Run from the marketplace repo root:

```bash
npx github:tianmuji/cc-to-codex-marketplace convert \
  --input .claude-plugin/marketplace.json \
  --output .agents/plugins/marketplace.json \
  --plugins-dir codex/plugins
```

Generated layout:

```text
.agents/plugins/marketplace.json
codex/plugins/<plugin>/.codex-plugin/plugin.json
codex/plugins/<plugin>/.mcp.json
codex/plugins/<plugin>/skills/<skill>/SKILL.md
```

## Validate

```bash
npx github:tianmuji/cc-to-codex-marketplace validate \
  --marketplace .agents/plugins/marketplace.json \
  --root .
```

## CI Check

`check` regenerates Codex artifacts, validates them, and fails if generated files differ from the committed files.

```bash
npx github:tianmuji/cc-to-codex-marketplace check
```

GitLab CI example:

```yaml
validate-codex-marketplace:
  image: node:20
  script:
    - npm ci
    - npx github:tianmuji/cc-to-codex-marketplace check
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
GITLAB_TOKEN=... npx github:tianmuji/cc-to-codex-marketplace convert
```

In GitLab CI, `CI_JOB_TOKEN` is also supported.

For GitHub sources:

```bash
GITHUB_TOKEN=... npx github:tianmuji/cc-to-codex-marketplace convert
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
- an MCP-backed plugin

## License

MIT
