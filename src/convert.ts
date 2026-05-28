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
  CodexMarketplace,
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

function normalizeMcpJson(pluginDir: string) {
  const mcpPath = join(pluginDir, '.mcp.json')
  if (!existsSync(mcpPath)) return false

  const mcp = readJson<Record<string, unknown>>(mcpPath)
  const normalized = Object.prototype.hasOwnProperty.call(mcp, 'mcpServers')
    ? mcp
    : { mcpServers: mcp }

  writeJson(mcpPath, normalized)
  return true
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
  const hasMcp = normalizeMcpJson(outputDir)
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
  }

  const inputPath = resolve(root, options.input)
  const marketplace = readJson<ClaudeMarketplace>(inputPath)
  const marketplaceName = options.marketplaceName || marketplace.name || 'converted'
  const displayName = options.displayName || marketplace.interface?.displayName || marketplaceName

  if (resolved.clean) {
    ensureCleanDir(resolve(root, options.pluginsDir))
    ensureCleanDir(resolve(root, options.workDir))
  }

  for (const entry of marketplace.plugins) {
    console.log(`Generating ${entry.name}`)
    generatePlugin(entry, resolved, root)
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
