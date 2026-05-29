import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import YAML from 'yaml'
import { copyDirectory, ensureCleanDir, readJson, remove, writeJson } from './fs.js'
import { fetchGitSubdir } from './git.js'
import type {
  ClaudeMarketplace,
  ClaudeMarketplacePlugin,
  ClaudePluginJson,
  CodexMcpAuthOverride,
  CodexMcpServerOverride,
  CodexMarketplace,
  CodexOverrides,
  CodexPluginOverride,
  ConvertOptions,
} from './types.js'

function normalizeCategory(category?: string) {
  if (!category) return 'Productivity'
  if (category.toLowerCase() === 'development') return 'Coding'
  return category
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 3)}...`
}

function outputPath(root: string, path: string) {
  const rel = relative(root, path).replaceAll('\\', '/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

function resolveSourceDir(entry: ClaudeMarketplacePlugin, workDir: string, root: string) {
  if (entry.source.source === 'local') {
    return resolve(root, entry.source.path)
  }

  return fetchGitSubdir(entry, workDir)
}

function readClaudePluginJson(sourceDir: string): ClaudePluginJson {
  const path = join(sourceDir, '.claude-plugin', 'plugin.json')
  if (!existsSync(path)) return {}
  return readJson<ClaudePluginJson>(path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readOverrides(root: string, path?: string): CodexOverrides {
  if (!path) return {}

  const resolved = resolve(root, path)
  if (!existsSync(resolved)) return {}

  const raw = readFileSync(resolved, 'utf-8')
  const parsed = YAML.parse(raw)
  return isRecord(parsed) ? parsed as CodexOverrides : {}
}

function normalizeMcpServers(value: Record<string, unknown>) {
  const servers = value.mcpServers
  if (isRecord(servers)) return servers
  return value
}

function normalizeTransport(transport?: string) {
  if (!transport) return undefined
  if (transport === 'streamable-http' || transport === 'streamable_http' || transport === 'http') {
    return 'streamable_http'
  }
  if (transport === 'stdio') return 'stdio'
  throw new Error(`Unsupported MCP transport: ${transport}`)
}

function selectEnvString(
  value: string | Record<string, string> | undefined,
  envName: string,
  context: string,
) {
  if (typeof value === 'string') return value
  if (!value) throw new Error(`${context} is required`)
  if (value[envName]) return value[envName]
  if (value.default) return value.default
  throw new Error(`${context} has no value for env "${envName}" and no default`)
}

function normalizeScopes(scopes: CodexMcpAuthOverride['scopes']) {
  if (!scopes) return []
  if (Array.isArray(scopes)) return scopes
  return scopes.split(',').map(scope => scope.trim()).filter(Boolean)
}

function bearerTokenEnvVar(auth?: CodexMcpAuthOverride) {
  return auth?.bearerTokenEnvVar || auth?.bearer_token_env_var || auth?.envVar
}

function copyOptionalServerFields(
  target: Record<string, unknown>,
  original: Record<string, unknown>,
  override: CodexMcpServerOverride,
) {
  for (const key of ['startup_timeout_sec', 'tool_timeout_sec'] as const) {
    if (override[key] !== undefined) {
      target[key] = override[key]
    } else if (original[key] !== undefined) {
      target[key] = original[key]
    }
  }
}

function buildHttpMcpServer(
  pluginName: string,
  serverName: string,
  original: Record<string, unknown>,
  override: CodexMcpServerOverride,
  envName: string,
) {
  const server: Record<string, unknown> = {
    url: selectEnvString(override.url || original.url as string | Record<string, string> | undefined, envName, `${pluginName}.${serverName}.url`),
  }

  if (override.http_headers) server.http_headers = override.http_headers
  if (override.env_http_headers) server.env_http_headers = override.env_http_headers

  const authType = override.auth?.type
  if (authType === 'bearer') {
    const envVar = bearerTokenEnvVar(override.auth)
    if (!envVar) throw new Error(`${pluginName}.${serverName}.auth.bearerTokenEnvVar is required`)
    server.bearer_token_env_var = envVar
  } else if (original.bearer_token_env_var !== undefined) {
    server.bearer_token_env_var = original.bearer_token_env_var
  }

  copyOptionalServerFields(server, original, override)
  return server
}

function buildStdioMcpServer(
  pluginName: string,
  serverName: string,
  original: Record<string, unknown>,
  override: CodexMcpServerOverride,
) {
  const server: Record<string, unknown> = { ...original }

  if (override.command) server.command = override.command
  if (override.args) server.args = override.args
  if (override.env) server.env = override.env

  if (!server.command) {
    throw new Error(`${pluginName}.${serverName}.command is required for stdio MCP servers`)
  }

  delete server.url
  delete server.bearer_token_env_var
  return server
}

function authMetadataForServer(serverName: string, override?: CodexMcpServerOverride) {
  const auth = override?.auth
  if (!auth?.type || auth.type === 'none') return undefined

  if (auth.type === 'bearer') {
    const envVar = bearerTokenEnvVar(auth)
    return envVar ? { type: 'bearer', bearer_token_env_var: envVar } : undefined
  }

  const scopes = normalizeScopes(auth.scopes)
  return {
    type: 'oauth',
    scopes,
    loginCommand: scopes.length > 0
      ? `codex mcp login ${serverName} --scopes ${scopes.join(',')}`
      : `codex mcp login ${serverName}`,
  }
}

function normalizeMcpJson(
  pluginDir: string,
  pluginName: string,
  override?: CodexPluginOverride,
  envName = 'default',
) {
  const mcpPath = join(pluginDir, '.mcp.json')
  const hasMcpFile = existsSync(mcpPath)
  const hasOverrideServers = !!override?.mcpServers && Object.keys(override.mcpServers).length > 0
  if (!hasMcpFile && !hasOverrideServers) return { hasMcp: false }

  const originalMcp = hasMcpFile ? readJson<Record<string, unknown>>(mcpPath) : {}
  const originalServers = normalizeMcpServers(originalMcp)
  const overrideServers = override?.mcpServers || {}
  const serverNames = Array.from(new Set([
    ...Object.keys(originalServers),
    ...Object.keys(overrideServers),
  ]))
  const mcpServers: Record<string, unknown> = {}
  const authMetadata: Record<string, unknown> = {}

  for (const serverName of serverNames) {
    const original = isRecord(originalServers[serverName]) ? originalServers[serverName] : {}
    const serverOverride = overrideServers[serverName]

    if (!serverOverride) {
      mcpServers[serverName] = original
      continue
    }

    const transport = normalizeTransport(serverOverride.transport)
      || (serverOverride.url || original.url ? 'streamable_http' : 'stdio')

    mcpServers[serverName] = transport === 'streamable_http'
      ? buildHttpMcpServer(pluginName, serverName, original, serverOverride, envName)
      : buildStdioMcpServer(pluginName, serverName, original, serverOverride)

    const metadata = authMetadataForServer(serverName, serverOverride)
    if (metadata) authMetadata[serverName] = metadata
  }

  writeJson(mcpPath, { mcpServers })
  return {
    hasMcp: Object.keys(mcpServers).length > 0,
    authMetadata: Object.keys(authMetadata).length > 0 ? { mcpServers: authMetadata } : undefined,
  }
}

function normalizeSkillFrontmatter(skillPath: string, fallbackName: string) {
  const original = readFileSync(skillPath, 'utf-8')

  if (!original.startsWith('---')) {
    writeFileSync(
      skillPath,
      `---\nname: ${fallbackName}\ndescription: ${fallbackName} skill\n---\n\n${original}`,
    )
    return
  }

  const end = original.indexOf('---', 3)
  if (end === -1) return

  const rawFrontmatter = original.slice(3, end)
  const body = original.slice(end + 3).replace(/^\r?\n/, '')
  let parsed: { name?: string; description?: string } = {}

  try {
    const value = YAML.parse(rawFrontmatter)
    if (value && typeof value === 'object') {
      parsed = value as { name?: string; description?: string }
    }
  } catch {
    parsed = {}
  }

  const normalized = {
    name: parsed.name || fallbackName,
    description: parsed.description || `${fallbackName} skill`,
  }

  writeFileSync(
    skillPath,
    `---\n${YAML.stringify(normalized).trimEnd()}\n---\n\n${body}`,
  )
}

function normalizeSkills(pluginDir: string, entryName: string) {
  const skillsDir = join(pluginDir, 'skills')
  const rootSkill = join(pluginDir, 'SKILL.md')

  if (!existsSync(skillsDir) && existsSync(rootSkill)) {
    const nestedSkillDir = join(skillsDir, entryName)
    mkdirSync(nestedSkillDir, { recursive: true })
    writeFileSync(join(nestedSkillDir, 'SKILL.md'), readFileSync(rootSkill))
    rmSync(rootSkill, { force: true })
  }

  if (!existsSync(skillsDir)) return false

  for (const skillName of readdirSync(skillsDir)) {
    const skillDir = join(skillsDir, skillName)
    if (!statSync(skillDir).isDirectory()) continue

    const skillPath = join(skillDir, 'SKILL.md')
    if (existsSync(skillPath)) normalizeSkillFrontmatter(skillPath, skillName)

    rmSync(join(skillDir, 'agents', 'openai.yaml'), { force: true })
  }

  return true
}

function generatePlugin(
  entry: ClaudeMarketplacePlugin,
  options: Required<ConvertOptions>,
  root: string,
  overrides: CodexOverrides,
) {
  const sourceDir = resolveSourceDir(entry, options.workDir, root)
  const outputDir = resolve(root, options.pluginsDir, entry.name)

  remove(outputDir)
  mkdirSync(dirname(outputDir), { recursive: true })
  copyDirectory(sourceDir, outputDir)

  const claudePlugin = readClaudePluginJson(sourceDir)
  const description = entry.description || claudePlugin.description || `${entry.name} plugin`
  const author = claudePlugin.author?.name ? claudePlugin.author : { name: 'Unknown' }
  const hasSkills = normalizeSkills(outputDir, entry.name)
  const mcpResult = normalizeMcpJson(
    outputDir,
    entry.name,
    overrides.plugins?.[entry.name],
    options.env,
  )
  const hasMcp = mcpResult.hasMcp
  const capabilities = hasMcp ? ['Interactive', 'Read', 'Write'] : ['Read']

  const pluginJson: Record<string, unknown> = {
    name: entry.name,
    version: claudePlugin.version || '1.0.0',
    description,
    author,
    keywords: Array.from(new Set([entry.name, ...(claudePlugin.keywords || [])])),
    interface: {
      displayName: entry.name,
      shortDescription: truncate(description, 140),
      longDescription: description,
      developerName: author.name || 'Unknown',
      category: normalizeCategory(entry.category),
      capabilities,
      defaultPrompt: [`Help me use ${entry.name}.`],
    },
  }

  if (entry.source.source === 'git-subdir') pluginJson.repository = entry.source.url
  if (claudePlugin.homepage) pluginJson.homepage = claudePlugin.homepage
  if (claudePlugin.license) pluginJson.license = claudePlugin.license
  if (hasSkills) pluginJson.skills = './skills/'
  if (hasMcp) pluginJson.mcpServers = './.mcp.json'

  if (mcpResult.authMetadata) {
    writeJson(join(outputDir, '.codex-plugin', 'mcp-auth.json'), mcpResult.authMetadata)
  }

  writeJson(join(outputDir, '.codex-plugin', 'plugin.json'), pluginJson)
}

export function convert(options: ConvertOptions) {
  const root = process.cwd()
  const resolved: Required<ConvertOptions> = {
    clean: true,
    marketplaceName: options.marketplaceName || '',
    displayName: options.displayName || '',
    input: options.input,
    output: options.output,
    pluginsDir: options.pluginsDir,
    workDir: options.workDir,
    overrides: options.overrides || '',
    env: options.env || 'default',
  }

  const inputPath = resolve(root, options.input)
  const marketplace = readJson<ClaudeMarketplace>(inputPath)
  const overrides = readOverrides(root, resolved.overrides)
  const marketplaceName = options.marketplaceName || marketplace.name || 'converted'
  const displayName = options.displayName || marketplace.interface?.displayName || marketplaceName

  if (resolved.clean) {
    ensureCleanDir(resolve(root, options.pluginsDir))
    ensureCleanDir(resolve(root, options.workDir))
  }

  for (const entry of marketplace.plugins) {
    console.log(`Generating ${entry.name}`)
    generatePlugin(entry, resolved, root, overrides)
  }

  const codexMarketplace: CodexMarketplace = {
    name: marketplaceName,
    interface: {
      displayName,
    },
    plugins: marketplace.plugins.map(entry => {
      const pluginDir = resolve(root, options.pluginsDir, entry.name)
      return {
        name: entry.name,
        source: {
          source: 'local',
          path: outputPath(root, pluginDir),
        },
        policy: {
          installation: 'AVAILABLE',
          authentication: 'ON_INSTALL',
        },
        category: normalizeCategory(entry.category),
      }
    }),
  }

  writeJson(resolve(root, options.output), codexMarketplace)
  remove(resolve(root, options.workDir))

  console.log(`\nGenerated ${marketplace.plugins.length} Codex plugin(s)`)
  console.log(`Marketplace: ${options.output}`)
}
