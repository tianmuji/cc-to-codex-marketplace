import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ClaudeMarketplacePlugin } from './types.js'

export function run(cmd: string, args: string[], cwd?: string) {
  execFileSync(cmd, args, {
    cwd,
    stdio: 'pipe',
    env: process.env,
  })
}

export function gitUrlForFetch(url: string) {
  if (url.startsWith('https://gitlab.')) {
    const privateToken = process.env.GITLAB_TOKEN
    if (privateToken) {
      const parsed = new URL(url)
      parsed.username = 'oauth2'
      parsed.password = privateToken
      return parsed.toString()
    }

    const jobToken = process.env.CI_JOB_TOKEN
    if (jobToken) {
      const parsed = new URL(url)
      parsed.username = 'gitlab-ci-token'
      parsed.password = jobToken
      return parsed.toString()
    }
  }

  if (url.startsWith('https://github.com/')) {
    const token = process.env.GITHUB_TOKEN
    if (token) {
      const parsed = new URL(url)
      parsed.username = 'x-access-token'
      parsed.password = token
      return parsed.toString()
    }
  }

  return url
}

export function fetchGitSubdir(entry: ClaudeMarketplacePlugin, workDir: string) {
  if (entry.source.source !== 'git-subdir') {
    throw new Error(`Plugin ${entry.name} is not a git-subdir source`)
  }

  const cloneDir = join(workDir, entry.name)
  mkdirSync(cloneDir, { recursive: true })

  run('git', ['init'], cloneDir)
  run('git', ['remote', 'add', 'origin', gitUrlForFetch(entry.source.url)], cloneDir)

  if (entry.source.sha) {
    run('git', ['fetch', '--depth', '1', 'origin', entry.source.sha], cloneDir)
    run('git', ['checkout', 'FETCH_HEAD', '--', entry.source.path], cloneDir)
  } else if (entry.source.ref) {
    run('git', ['fetch', '--depth', '1', 'origin', entry.source.ref], cloneDir)
    run('git', ['checkout', 'FETCH_HEAD', '--', entry.source.path], cloneDir)
  } else {
    throw new Error(`Plugin ${entry.name} git-subdir source needs sha or ref`)
  }

  return entry.source.path === '.' ? cloneDir : join(cloneDir, entry.source.path)
}
