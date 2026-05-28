import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function remove(path: string) {
  rmSync(path, { recursive: true, force: true })
}

export function copyDirectory(src: string, dest: string) {
  cpSync(src, dest, {
    recursive: true,
    filter: source => {
      const base = source.split('/').pop()
      if (!base) return true
      return ![
        '.git',
        'node_modules',
        '.claude-plugin',
        '.codex-plugin',
        '.DS_Store',
      ].includes(base)
    },
  })
}

export function ensureCleanDir(path: string) {
  remove(path)
  mkdirSync(path, { recursive: true })
}

export function fileExists(path: string) {
  return existsSync(path)
}
