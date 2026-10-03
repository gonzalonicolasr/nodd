import type { Fs } from './core/io-core.ts'
import { GATE_IDS, type GateId } from './core/gates/registry.ts'
import { resolveFlag, type Policy } from './core/gates/policy.ts'
import type { Committed } from './core/state.ts'

export const VERSION = '0.1.0'
export const MAIN = 'main'
export const ENFORCED: readonly GateId[] = ['authorize', 'classify', 'track']
export const CC_FLAGS: Record<string, boolean> = Object.fromEntries(
  GATE_IDS.filter((id) => !ENFORCED.includes(id)).map((id) => [id, false]),
)

const RESERVED = new Set(['tool', 'tool_use_id', 'agentId', 'consent'])
const RENAMED: Record<string, string> = {
  Write: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Bash: 'bash',
  Read: 'read',
  Glob: 'find',
  Grep: 'grep',
  LS: 'ls',
  Agent: 'subagent',
  Task: 'subagent',
}

export type NoddNames = { declare: string; task: string }
export type Call = { toolName: string; input: Record<string, unknown> }

export function normalizeCall(tool: string, envelope: Record<string, unknown>, names: NoddNames): Call {
  const input: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(envelope)) if (!RESERVED.has(key)) input[key] = value
  if (tool === names.declare) return { toolName: 'nodd_declare', input }
  if (tool === names.task) return { toolName: 'nodd_task', input }
  if (tool === 'NotebookEdit' && typeof input.notebook_path === 'string') input.file_path = input.notebook_path
  if ((tool === 'Agent' || tool === 'Task') && typeof input.subagent_type === 'string') input.agent = input.subagent_type
  return { toolName: RENAMED[tool] ?? tool, input }
}

export function isForgeType(type: string | undefined): boolean {
  return typeof type === 'string' && type.startsWith('forge:')
}

export function forgeIsRunning(text: string | null): boolean {
  if (!text) return false
  try {
    const status = JSON.parse(text)?.run?.status
    return status === 'running' || status === 'paused'
  } catch {
    return false
  }
}

export function gateOfReason(reason: string): string {
  return /^nodd\/([a-z]+):/.exec(reason)?.[1] ?? 'unknown'
}

export const BUILTIN_AGENTS: Record<string, boolean> = {
  explore: true,
  plan: true,
  'claude-code-guide': true,
  'statusline-setup': false,
  'general-purpose': false,
}

const WRITERS = new Set(['write', 'edit', 'multiedit', 'notebookedit'])

function toolList(frontmatter: string): string[] | null {
  const inline = /^tools:[ \t]*(\S.*)$/m.exec(frontmatter)?.[1]
  if (inline !== undefined) {
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((t) => t.trim().replace(/^["']|["']$/g, ''))
      .filter((t) => t !== '')
  }
  const block = /^tools:[ \t]*\n((?:[ \t]+-[^\n]*\n?)+)/m.exec(frontmatter)?.[1]
  if (block !== undefined) {
    return block
      .split('\n')
      .map((line) => line.replace(/^[ \t]+-[ \t]*/, '').trim().replace(/^["']|["']$/g, ''))
      .filter((t) => t !== '')
  }
  return null
}

export function agentReadOnly(text: string, agentName: string): boolean | null {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  if (!frontmatter) return null
  const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim().replace(/^["']|["']$/g, '')
  if (!name || name.toLowerCase() !== agentName.toLowerCase()) return null
  const tools = toolList(frontmatter)
  if (tools === null) return false
  return !tools.some((t) => WRITERS.has(t.toLowerCase()))
}

export type StagedFs = Fs & {
  seed(path: string, text: string | null): void
  drain(): Array<[string, string]>
}

function missing(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file, '${path}'`), { code: 'ENOENT' })
}

export function stagedFs(): StagedFs {
  const files = new Map<string, string | null>()
  const dirty = new Set<string>()
  return {
    seed(path, text) {
      if (!dirty.has(path)) files.set(path, text)
    },
    drain() {
      const out: Array<[string, string]> = []
      for (const path of dirty) {
        const text = files.get(path)
        if (typeof text === 'string') out.push([path, text])
      }
      dirty.clear()
      return out
    },
    existsSync(path) {
      return typeof files.get(path) === 'string'
    },
    readFileSync(path) {
      const text = files.get(path)
      if (typeof text !== 'string') throw missing(path)
      return text
    },
    writeFileSync(path, data) {
      files.set(path, data)
      dirty.add(path)
    },
    renameSync(from, to) {
      const text = files.get(from)
      if (typeof text !== 'string') throw missing(from)
      files.set(to, text)
      files.set(from, null)
      dirty.delete(from)
      dirty.add(to)
    },
    unlinkSync(path) {
      files.set(path, null)
      dirty.delete(path)
    },
    mkdirSync() {},
  }
}

export type Refusal = { gate: string; reason: string; at: string }

export type Snapshot = {
  version: string
  enabled: boolean
  gates: Array<{ id: GateId; enabled: boolean; enforcedInClaudeCode: boolean }>
  declaration: { slug: string; intent: string; route: string } | null
  lastRefusal: Refusal | null
  counters: { toolCalls: number; filesRead: number; filesWritten: number; delegations: number; refusals: number; agents: number }
}

export function snapshot(input: {
  enabled: boolean
  config: Policy['config']
  committed: Committed | null
  lastRefusal: Refusal | null
  refusals: number
  agents: number
}): Snapshot {
  const policy: Policy = { config: input.config, flags: {}, hatches: {} }
  const declaration = input.committed?.declaration ?? null
  return {
    version: VERSION,
    enabled: input.enabled,
    gates: GATE_IDS.map((id) => ({
      id,
      enabled: resolveFlag(id, policy).enabled,
      enforcedInClaudeCode: ENFORCED.includes(id),
    })),
    declaration: declaration && { slug: declaration.slug, intent: declaration.intent, route: declaration.route },
    lastRefusal: input.lastRefusal,
    counters: {
      toolCalls: input.committed?.toolCalls ?? 0,
      filesRead: input.committed?.filesRead.size ?? 0,
      filesWritten: input.committed?.filesWritten.size ?? 0,
      delegations: input.committed?.delegations ?? 0,
      refusals: input.refusals,
      agents: input.agents,
    },
  }
}
