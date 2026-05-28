import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { readJson } from './fs.js'
import type { CodexMarketplace, ValidateOptions } from './types.js'

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
