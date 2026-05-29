export interface ClaudeMarketplace {
  name?: string
  interface?: {
    displayName?: string
  }
  plugins: ClaudeMarketplacePlugin[]
}

export interface ClaudeMarketplacePlugin {
  name: string
  description?: string
  category?: string
  source: ClaudePluginSource
}

export type ClaudePluginSource =
  | {
      source: 'git-subdir'
      url: string
      path: string
      ref?: string
      sha?: string
    }
  | {
      source: 'local'
      path: string
    }

export interface ClaudePluginJson {
  name?: string
  version?: string
  description?: string
  author?: {
    name?: string
    email?: string
    url?: string
  }
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
}

export interface CodexMarketplace {
  name: string
  interface: {
    displayName: string
  }
  plugins: CodexMarketplacePlugin[]
}

export interface CodexMarketplacePlugin {
  name: string
  source: {
    source: 'local'
    path: string
  }
  policy: {
    installation: 'AVAILABLE' | 'INSTALLED_BY_DEFAULT' | 'NOT_AVAILABLE'
    authentication: 'ON_INSTALL' | 'ON_USE'
  }
  category: string
}

export interface ConvertOptions {
  input: string
  output: string
  pluginsDir: string
  workDir: string
  overrides?: string
  env?: string
  marketplaceName?: string
  displayName?: string
  clean?: boolean
}

export interface ValidateOptions {
  marketplace: string
  root: string
}

export interface CodexOverrides {
  plugins?: Record<string, CodexPluginOverride>
}

export interface CodexPluginOverride {
  mcpServers?: Record<string, CodexMcpServerOverride>
}

export type CodexMcpTransport = 'stdio' | 'streamable_http' | 'streamable-http' | 'http'

export interface CodexMcpServerOverride {
  transport?: CodexMcpTransport
  url?: string | Record<string, string>
  command?: string
  args?: string[]
  env?: Record<string, string>
  auth?: CodexMcpAuthOverride
  http_headers?: Record<string, string>
  env_http_headers?: Record<string, string>
  startup_timeout_sec?: number
  tool_timeout_sec?: number
}

export interface CodexMcpAuthOverride {
  type?: 'none' | 'bearer' | 'oauth'
  bearerTokenEnvVar?: string
  bearer_token_env_var?: string
  envVar?: string
  scopes?: string[] | string
}
