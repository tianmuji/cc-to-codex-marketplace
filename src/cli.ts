#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { convert } from './convert.js'
import { validate } from './validate.js'

type Args = Record<string, string | boolean>

function parseArgs(argv: string[]) {
  const command = argv[2]
  const args: Args = {}

  for (let index = 3; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith('--')) continue

    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      index++
    }
  }

  return { command, args }
}

function stringArg(args: Args, key: string, fallback: string) {
  const value = args[key]
  return typeof value === 'string' ? value : fallback
}

function optionalStringArg(args: Args, key: string) {
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

function usage() {
  console.log(`cc-to-codex-marketplace

Convert Claude Code plugin marketplaces into Codex-compatible plugin marketplaces.

Usage:
  cc-to-codex-marketplace convert [options]
  cc-to-codex-marketplace validate [options]
  cc-to-codex-marketplace check [options]

Options:
  --input <path>          Claude marketplace file (default: .claude-plugin/marketplace.json)
  --output <path>         Codex marketplace file (default: .agents/plugins/marketplace.json)
  --plugins-dir <path>    Generated Codex plugin directory (default: codex/plugins)
  --work-dir <path>       Temporary fetch directory (default: .cc-to-codex-work)
  --overrides <path>      Codex override file (default: codex-overrides.yaml, ignored if missing)
  --env <name>            Environment for override URL selection (default: default)
  --marketplace-name <n>  Override generated marketplace name
  --display-name <n>      Override generated marketplace display name
  --root <path>           Validation root (default: .)
  --marketplace <path>    Marketplace file for validate (default: .agents/plugins/marketplace.json)

Environment:
  GITLAB_TOKEN, CI_JOB_TOKEN, GITHUB_TOKEN are used for private git-subdir sources.
`)
}

function convertOptions(args: Args) {
  return {
    input: stringArg(args, 'input', '.claude-plugin/marketplace.json'),
    output: stringArg(args, 'output', '.agents/plugins/marketplace.json'),
    pluginsDir: stringArg(args, 'plugins-dir', 'codex/plugins'),
    workDir: stringArg(args, 'work-dir', '.cc-to-codex-work'),
    overrides: stringArg(args, 'overrides', 'codex-overrides.yaml'),
    env: stringArg(args, 'env', 'default'),
    marketplaceName: optionalStringArg(args, 'marketplace-name'),
    displayName: optionalStringArg(args, 'display-name'),
  }
}

function validateOptions(args: Args) {
  return {
    marketplace: stringArg(args, 'marketplace', '.agents/plugins/marketplace.json'),
    root: stringArg(args, 'root', '.'),
  }
}

function gitDiffOrExit(paths: string[]) {
  try {
    execFileSync('git', ['diff', '--exit-code', '--', ...paths], { stdio: 'inherit' })
  } catch {
    console.error('\nGenerated Codex marketplace artifacts are stale.')
    console.error('Run cc-to-codex-marketplace convert and commit the generated files.')
    process.exit(1)
  }
}

function main() {
  const { command, args } = parseArgs(process.argv)

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage()
    return
  }

  if (command === 'convert') {
    convert(convertOptions(args))
    return
  }

  if (command === 'validate') {
    validate(validateOptions(args))
    return
  }

  if (command === 'check') {
    const options = convertOptions(args)
    convert(options)
    validate({
      marketplace: options.output,
      root: '.',
    })
    gitDiffOrExit([options.output, options.pluginsDir])
    return
  }

  console.error(`Unknown command: ${command}`)
  usage()
  process.exit(1)
}

main()
