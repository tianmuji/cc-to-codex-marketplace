import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { readJson } from './fs.js'
import type { CodexMarketplace, ValidateOptions } from './types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isEnvVarName(value: unknown) {
  return typeof value === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(value)
}

function validateNoStaticSecrets(
  server: Record<string, unknown>,
  prefix: string,
  serverName: string,
  errors: string[],
) {
  for (const key of ['bearer_token', 'access_token', 'refresh_token', 'client_secret'] as const) {
    if (server[key] !== undefined) {
      errors.push(`${prefix} ${serverName}.${key} must not be committed; use bearer_token_env_var or OAuth`)
    }
  }

  if (isRecord(server.http_headers)) {
    for (const key of Object.keys(server.http_headers)) {
      if (key.toLowerCase() === 'authorization') {
        errors.push(`${prefix} ${serverName}.http_headers.Authorization must not be committed; use bearer_token_env_var or OAuth`)
      }
    }
  }
}

function validateMcpServer(
  prefix: string,
  serverName: string,
  rawServer: unknown,
  errors: string[],
) {
  if (!isRecord(rawServer)) {
    errors.push(`${prefix} mcpServers.${serverName} must be an object`)
    return
  }

  const hasUrl = typeof rawServer.url === 'string'
  const hasCommand = typeof rawServer.command === 'string'

  validateNoStaticSecrets(rawServer, prefix, serverName, errors)

  if (rawServer.bearer_token_env_var !== undefined && !isEnvVarName(rawServer.bearer_token_env_var)) {
    errors.push(`${prefix} ${serverName}.bearer_token_env_var must be an environment variable name`)
  }

  if (hasUrl) {
    if (!/^https?:\/\//.test(rawServer.url as string)) {
      errors.push(`${prefix} ${serverName}.url must start with http:// or https://`)
    }
    if (rawServer.command !== undefined || rawServer.args !== undefined || rawServer.env !== undefined) {
      errors.push(`${prefix} ${serverName} cannot mix streamable HTTP url with stdio command/args/env`)
    }
    return
  }

  if (rawServer.bearer_token_env_var !== undefined) {
    errors.push(`${prefix} ${serverName}.bearer_token_env_var is only valid for streamable HTTP servers`)
  }

  if (!hasCommand) {
    errors.push(`${prefix} ${serverName}.command is required for stdio MCP servers`)
  }
}

function validateAuthMetadata(
  prefix: string,
  pluginDir: string,
  mcpServers: Record<string, unknown>,
  errors: string[],
) {
  const authPath = resolve(pluginDir, '.codex-plugin/mcp-auth.json')
  if (!existsSync(authPath)) return

  const auth = readJson<{ mcpServers?: Record<string, unknown> }>(authPath)
  if (!isRecord(auth.mcpServers)) {
    errors.push(`${prefix} .codex-plugin/mcp-auth.json must contain mcpServers`)
    return
  }

  for (const [serverName, rawMetadata] of Object.entries(auth.mcpServers)) {
    if (!isRecord(rawMetadata)) {
      errors.push(`${prefix} mcp-auth ${serverName} must be an object`)
      continue
    }

    const type = rawMetadata.type
    if (type !== 'oauth' && type !== 'bearer') {
      errors.push(`${prefix} mcp-auth ${serverName}.type must be oauth or bearer`)
      continue
    }

    const rawServer = mcpServers[serverName]
    if (!isRecord(rawServer)) {
      errors.push(`${prefix} mcp-auth ${serverName} has no matching MCP server`)
      continue
    }

    if (type === 'oauth' && typeof rawServer.url !== 'string') {
      errors.push(`${prefix} mcp-auth ${serverName} oauth requires a streamable HTTP MCP server`)
    }

    if (type === 'oauth' && rawMetadata.scopes !== undefined) {
      const scopes = rawMetadata.scopes
      if (!Array.isArray(scopes) || scopes.some(scope => typeof scope !== 'string')) {
        errors.push(`${prefix} mcp-auth ${serverName}.scopes must be an array of strings`)
      }
    }

    if (type === 'bearer' && !isEnvVarName(rawMetadata.bearer_token_env_var)) {
      errors.push(`${prefix} mcp-auth ${serverName}.bearer_token_env_var must be an environment variable name`)
    }
  }
}

export function validate(options: ValidateOptions) {
  const errors: string[] = []
  const root = resolve(process.cwd(), options.root)
  const marketplacePath = resolve(process.cwd(), options.marketplace)

  if (!existsSync(marketplacePath)) {
    throw new Error(`Marketplace file not found: ${options.marketplace}`)
  }

  const marketplace = readJson<CodexMarketplace>(marketplacePath)
  if (!marketplace.name) errors.push('marketplace.name is required')
  if (!marketplace.interface?.displayName) errors.push('marketplace.interface.displayName is required')
  if (!Array.isArray(marketplace.plugins)) errors.push('marketplace.plugins must be an array')

  for (const entry of marketplace.plugins || []) {
    const prefix = `[${entry.name || 'unnamed'}]`
    if (!entry.name) errors.push(`${prefix} name is required`)
    if (entry.source?.source !== 'local') errors.push(`${prefix} source.source must be local`)
    if (!entry.source?.path) errors.push(`${prefix} source.path is required`)
    if (!entry.policy?.installation) errors.push(`${prefix} policy.installation is required`)
    if (!entry.policy?.authentication) errors.push(`${prefix} policy.authentication is required`)
    if (!entry.category) errors.push(`${prefix} category is required`)

    if (!entry.source?.path) continue

    const pluginDir = resolve(root, entry.source.path)
    const pluginJsonPath = resolve(pluginDir, '.codex-plugin/plugin.json')
    if (!existsSync(pluginJsonPath)) {
      errors.push(`${prefix} missing .codex-plugin/plugin.json`)
      continue
    }

    const pluginJson = readJson<{
      name?: string
      version?: string
      description?: string
      author?: { name?: string }
      skills?: string
      mcpServers?: string
      interface?: {
        displayName?: string
        shortDescription?: string
        longDescription?: string
        developerName?: string
        category?: string
        capabilities?: string[]
      }
    }>(pluginJsonPath)

    if (pluginJson.name !== entry.name) {
      errors.push(`${prefix} plugin.json name mismatch: ${pluginJson.name}`)
    }
    if (!pluginJson.version) errors.push(`${prefix} plugin.json version is required`)
    if (!pluginJson.description) errors.push(`${prefix} plugin.json description is required`)
    if (!pluginJson.author?.name) errors.push(`${prefix} plugin.json author.name is required`)
    if (!pluginJson.interface?.displayName) errors.push(`${prefix} interface.displayName is required`)
    if (!pluginJson.interface?.shortDescription) errors.push(`${prefix} interface.shortDescription is required`)
    if (!pluginJson.interface?.longDescription) errors.push(`${prefix} interface.longDescription is required`)
    if (!pluginJson.interface?.developerName) errors.push(`${prefix} interface.developerName is required`)
    if (!pluginJson.interface?.category) errors.push(`${prefix} interface.category is required`)
    if (!pluginJson.interface?.capabilities?.length) errors.push(`${prefix} interface.capabilities is required`)

    if (pluginJson.skills) {
      const skillsDir = resolve(pluginDir, pluginJson.skills)
      if (!existsSync(skillsDir)) {
        errors.push(`${prefix} skills path does not exist: ${pluginJson.skills}`)
      } else {
        const skills = readdirSync(skillsDir).filter(name => statSync(resolve(skillsDir, name)).isDirectory())
        for (const skill of skills) {
          if (!existsSync(resolve(skillsDir, skill, 'SKILL.md'))) {
            errors.push(`${prefix} skills/${skill}/SKILL.md is required`)
          }
        }
      }
    }

    if (pluginJson.mcpServers) {
      const mcpPath = resolve(pluginDir, pluginJson.mcpServers)
      if (!existsSync(mcpPath)) {
        errors.push(`${prefix} mcpServers path does not exist: ${pluginJson.mcpServers}`)
      } else {
        const mcp = readJson<{ mcpServers?: Record<string, unknown> }>(mcpPath)
        if (!mcp.mcpServers || Object.keys(mcp.mcpServers).length === 0) {
          errors.push(`${prefix} .mcp.json must contain non-empty mcpServers`)
        } else {
          for (const [serverName, rawServer] of Object.entries(mcp.mcpServers)) {
            validateMcpServer(prefix, serverName, rawServer, errors)
          }
          validateAuthMetadata(prefix, pluginDir, mcp.mcpServers, errors)
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(`Validation failed with ${errors.length} error(s):`)
    for (const error of errors) console.error(`  - ${error}`)
    process.exitCode = 1
    return
  }

  console.log(`Valid Codex marketplace (${marketplace.plugins.length} plugin(s))`)
}
