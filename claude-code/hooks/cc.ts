import type { Fs } from './core/io-core.ts'
import { GATE_IDS, type GateId } from './core/gates/registry.ts'
import { resolveFlag, type Policy } from './core/gates/policy.ts'
import type { Committed } from './core/state.ts'

export const VERSION = '0.1.0'
export const MAIN = 'main'
export const ENFORCED: readonly GateId[] = ['authorize', 'classify', 'track', 'evidence']
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


export function gateOfReason(reason: string): string {
  return /^nodd\/([a-z]+):/.exec(reason)?.[1] ?? 'unknown'
}

export function ccReason(reason: string): string {
  return reason.replace(/\/nodd-allow /g, '/nodd allow ')
}

const REQUEST_ORIGINS = new Set(['composer', 'bridge', 'sdk'])

export function isNewRequest(e: { origin?: { kind?: string }; turnId?: string } | undefined): boolean {
  return REQUEST_ORIGINS.has(String(e?.origin?.kind)) && !e?.turnId
}

export const PROTOCOL = [
  'NODD is on in this session: the ODD protocol is enforced on your tool calls, not left to trust.',
  'For every user request:',
  '1. Authorize: a question, review or explanation is read-only. Do not write; if you declare, declare intent read-only.',
  '2. Explore in proportion to the request, and resolve uncertainty with at most one question before writing.',
  '3. Classify before the first write: call nodd_declare with intent, route, slug and summary.',
  '   inline = small, one-step work: send only intent, route, slug and summary. tracked = two or more steps, or progress worth resuming: it creates .nodd/<slug>/feature.md.',
  '   forge = needs a spec-driven run. Name the runner (the command that verifies the work) when there is one.',
  '4. Track: on tracked or forge, list the tasks with nodd_task. NODD writes .nodd/; never edit it yourself.',
  '5. Implement task by task. Delegate wide exploration and independent pieces to subagents.',
  '6. Close: the outcome, the checks you ran and what they returned, what failed, and the next step.',
  'Each new user request clears the previous declaration: declare again before its first write. To continue the previous request\'s feature, nodd_declare with only its slug is enough.',
  'Your session scratchpad is yours: writing there needs no declaration.',
  'A refused call names its remedy. Only the user can grant a one-shot override, with /nodd allow <gate>.',
].join('\n')

export const REMINDER = 'NODD: new request. nodd_declare before its first write (only slug to continue).'

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
  sessionId: string
  enabled: boolean
  gates: Array<{ id: GateId; enabled: boolean; enforcedInClaudeCode: boolean }>
  declaration: { slug: string; intent: string; route: string } | null
  lastRefusal: Refusal | null
  counters: { toolCalls: number; filesRead: number; filesWritten: number; delegations: number; refusals: number; agents: number }
}

export function snapshot(input: {
  sessionId: string
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
    sessionId: input.sessionId,
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

export const CC_DECLARE_SCHEMA = {
  description: 'Declare intent and route before the first write of a request. To continue the previous request\'s feature, send only slug. A new feature needs intent, route, slug, summary; inline stops there, tracked/forge create .nodd/<slug>/feature.md and may add the other fields.',
  parameters: {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: ['read-only', 'change'] },
      route: { type: 'string', enum: ['inline', 'tracked', 'forge'] },
      slug: { type: 'string' },
      summary: { type: 'string', description: 'the objective, one sentence' },
      title: { type: 'string' },
      problem: { type: 'string' },
      scope: { type: 'string' },
      constraints: { type: 'string' },
      runner: { type: 'string', description: 'verification command, pinned once' },
      tdd: { type: 'string', enum: ['strict', 'off'], description: 'strict: a failing run before a checkoff' },
      files: { type: 'array', items: { type: 'string' } },
    },
    required: ['slug'],
  },
}

export const CC_TASK_SCHEMA = {
  description: 'Add, check off or reopen a task in the feature document. NODD writes the document.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'check', 'reopen'] },
      id: { type: 'string', description: 'task id, e.g. T1' },
      title: { type: 'string', description: 'required to add' },
      slug: { type: 'string' },
      reason: { type: 'string', description: 'required to reopen' },
    },
    required: ['action', 'id', 'slug'],
  },
}

export function inScratchpad(path: unknown, sessionId: string): boolean {
  if (typeof path !== 'string' || sessionId === '') return false
  if (/(^|\/)\.\.(\/|$)/.test(path)) return false
  path = path.replace(/\/\.(?=\/)/g, '').replace(/\/{2,}/g, '/')
  const id = sessionId.replace(/[^\w-]/g, '')
  return new RegExp(`^(?:/private)?/tmp/claude-\\d+/[^/]+/${id}/`).test(path)
}

export async function landsInScratchpad(
  stat: (path: string) => Promise<{ realPath?: string }>,
  path: unknown,
  sessionId: string,
): Promise<boolean> {
  if (!inScratchpad(path, sessionId)) return false
  let head = String(path)
  let rest = ''
  while (head.length > 1) {
    const found = await stat(head).then((s) => ({ real: s.realPath }), () => null)
    if (found) return found.real !== undefined && inScratchpad(found.real + rest, sessionId)
    const cut = head.lastIndexOf('/')
    rest = head.slice(cut) + rest
    head = head.slice(0, cut)
  }
  return false
}

const DECLARE_CORE = ['intent', 'route', 'summary'] as const

export function continueDeclaration(
  input: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
): { input: Record<string, unknown> } | { problem: string } {
  if (DECLARE_CORE.every((k) => typeof input[k] === 'string' && input[k] !== '')) return { input }
  if (previous && previous.slug === input.slug) return { input: { ...previous, ...input } }
  return { problem: `nodd_declare: ${String(input.slug ?? '')} is a new feature here, so send intent, route and summary too. To continue the previous request's feature, send only its slug.` }
}

export function bashOutcome(r: any): { isError: boolean; content: string } {
  const text = String(r?.text ?? '')
  const out = r?.result
  if (r?.isError === true) {
    const code = /^\s*Exit code (\d+)/.exec(text)?.[1]
    return { isError: true, content: code === undefined ? text : `${text}\nCommand exited with code ${code}` }
  }
  if (out?.interrupted === true) return { isError: true, content: `${text}\nCommand aborted` }
  if (typeof out?.timedOutAfterMs === 'number') return { isError: true, content: `${text}\nCommand timed out after ${Math.round(out.timedOutAfterMs / 1000)} seconds` }
  if (out?.backgroundTaskId) return { isError: true, content: text }
  return { isError: false, content: text }
}
