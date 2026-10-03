import { createKernel, DECLARE_SCHEMA, TASK_SCHEMA, featureDocPath, ledgerPath, type Kernel } from './core/kernel.ts'
import { GATE_IDS, isGateId, type GateId } from './core/gates/registry.ts'
import { grantHatch, resolveFlag, type Policy } from './core/gates/policy.ts'
import { mergeConfig, noddConfigPath, parseConfig } from './core/config-core.ts'
import { joinPath } from './core/path.ts'
import {
  BUILTIN_AGENTS,
  CC_FLAGS,
  ENFORCED,
  MAIN,
  agentReadOnly,
  forgeIsRunning,
  gateOfReason,
  isForgeType,
  normalizeCall,
  snapshot,
  stagedFs,
  type Call,
  type NoddNames,
  type Refusal,
} from './cc.ts'

const names: NoddNames = { declare: 'mcp__nodd__nodd_declare', task: 'mcp__nodd__nodd_task' }
const fs = stagedFs()
const kernels = new Map<string, Kernel>()
const agents = new Map<string, { type: string; parent: string }>()
const capabilities = new Map<string, boolean | null>()

let booted: Promise<void> | undefined
let home = ''
let cwd = ''
let headless = false
let enabled = false
let hatches: Policy['hatches'] = {}
let toolsRegistered = false
let lastRefusal: Refusal | null = null
let refusals = 0
let lastExport = ''

const configPath = () => noddConfigPath(home)
const forgeStatePath = () => joinPath(home, '.local', 'state', 'forge', 'state.json')
const statePath = () => joinPath(home, '.local', 'state', 'nodd', 'state.json')

async function readText($: any, path: string): Promise<string | null> {
  try {
    const text = await $.fs.read(path)
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

function boot($: any, sessionCwd?: string): Promise<void> {
  booted ??= (async () => {
    home = (await $.env.get('HOME').catch(() => '')) || ''
    headless = (await $.env.get('CLAUDE_CODE_ENTRYPOINT').catch(() => '')) === 'sdk-cli'
    cwd = sessionCwd || (await $.session.cwd().catch(() => '')) || ''
    enabled = (await $.store.get('enabled').catch(() => undefined)) === true
    const saved = await $.store.get('hatches').catch(() => undefined)
    hatches = saved && typeof saved === 'object' && !Array.isArray(saved) ? (saved as Policy['hatches']) : {}
  })()
  return booted
}

function configGates(): Policy['config'] {
  const text = fs.existsSync(configPath()) ? fs.readFileSync(configPath(), 'utf8') : undefined
  return parseConfig(text).config.gates
}

function loadPolicy(): Policy {
  return { config: configGates(), flags: { ...CC_FLAGS }, hatches: { ...hatches } }
}

function kernelFor(key: string): Kernel {
  const existing = kernels.get(key)
  if (existing) return existing
  const kernel = createKernel({
    fs,
    cwd,
    loadPolicy,
    isReadOnlyAgent: (name) => capabilities.get(name.toLowerCase()) ?? null,
    spendHatch: (gate) => {
      const next = { ...hatches }
      delete next[gate]
      hatches = next
    },
  })
  if (key !== MAIN) {
    const parent = kernels.get(agents.get(key)?.parent ?? MAIN)?.state.committed.declaration
    if (parent) kernel.state.committed = { ...kernel.state.committed, declaration: { ...parent, files: [...parent.files], seq: 0 } }
  }
  kernels.set(key, kernel)
  return kernel
}

async function stage($: any, paths: string[]) {
  for (const path of new Set(paths)) fs.seed(path, await readText($, path))
}

async function flush($: any): Promise<string[]> {
  const problems: string[] = []
  for (const [path, text] of fs.drain()) {
    try {
      await $.fs.write(path, text)
      const back = await readText($, path)
      if (back !== text) problems.push(`read-back mismatch on ${path}`)
    } catch (err) {
      problems.push(`${path}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return problems
}

async function saveHatches($: any) {
  await $.store.set('hatches', hatches).catch(() => undefined)
}

async function agentOf($: any, id: string): Promise<{ type: string; parent: string } | undefined> {
  const known = agents.get(id)
  if (known) return known
  const info = ((await $.agent.list().catch(() => [])) as any[]).find((a: any) => a.id === id)
  if (!info) return undefined
  const entry = { type: String(info.type ?? ''), parent: info.parentId ?? MAIN }
  agents.set(id, entry)
  return entry
}

async function insideForge($: any, e: any, key: string): Promise<boolean> {
  if ((e.tool === 'Agent' || e.tool === 'Task') && isForgeType(e.subagent_type)) return true
  let id = key
  for (let depth = 0; id !== MAIN && depth < 8; depth++) {
    const info = await agentOf($, id)
    if (!info) break
    if (isForgeType(info.type)) return true
    id = info.parent
  }
  return forgeIsRunning(await readText($, forgeStatePath()))
}

async function agentFiles($: any, dir: string): Promise<string[]> {
  const entries = ((await $.fs.list(dir).catch(() => [])) as any[]).filter((f: any) => String(f.name).endsWith('.md'))
  const texts: string[] = []
  for (const entry of entries) {
    const text = await readText($, joinPath(dir, String(entry.name)))
    if (text !== null) texts.push(text)
  }
  return texts
}

async function resolveCapability($: any, name: unknown) {
  if (typeof name !== 'string' || name === '') return
  const key = name.toLowerCase()
  if (key in BUILTIN_AGENTS) {
    capabilities.set(key, BUILTIN_AGENTS[key] ?? null)
    return
  }
  let found: boolean | null = null
  for (const dir of [joinPath(cwd, '.claude', 'agents'), joinPath(home, '.claude', 'agents')]) {
    for (const text of await agentFiles($, dir)) {
      const answer = agentReadOnly(text, name)
      if (answer !== null) {
        found = answer
        break
      }
    }
    if (found !== null) break
  }
  capabilities.set(key, found)
}

function pathsFor(kernel: Kernel, call: Call): string[] {
  const paths = [configPath()]
  const declared = kernel.state.committed.declaration?.slug
  if (declared) paths.push(featureDocPath(cwd, declared))
  const slug = call.input.slug
  if ((call.toolName === 'nodd_declare' || call.toolName === 'nodd_task') && typeof slug === 'string' && slug !== '') {
    paths.push(featureDocPath(cwd, slug), ledgerPath(cwd, slug))
  }
  return paths
}

async function exportState($: any) {
  if (headless || !home) return
  await stage($, [configPath()])
  const snap = snapshot({
    enabled,
    config: configGates(),
    committed: kernels.get(MAIN)?.state.committed ?? null,
    lastRefusal,
    refusals,
    agents: [...kernels.keys()].filter((k) => k !== MAIN).length,
  })
  const text = JSON.stringify(snap, null, 2) + '\n'
  if (text === lastExport) return
  lastExport = text
  await $.fs.write(statePath(), text).catch(() => undefined)
}

async function registerTools($: any) {
  if (toolsRegistered) return
  try {
    const declare = await $.tool.register({ name: 'nodd_declare', description: DECLARE_SCHEMA.description, inputSchema: DECLARE_SCHEMA.parameters })
    const task = await $.tool.register({ name: 'nodd_task', description: TASK_SCHEMA.description, inputSchema: TASK_SCHEMA.parameters })
    if (typeof declare?.tool === 'string') names.declare = declare.tool
    if (typeof task?.tool === 'string') names.task = task.tool
    toolsRegistered = true
  } catch (err) {
    $.ui.log(`nodd: no pude registrar las tools: ${err}`, { to: 'debug' })
  }
}

async function serve($: any, kernel: Kernel, call: Call, id: string) {
  await stage($, pathsFor(kernel, call))
  kernel.onToolCall({ toolName: call.toolName, toolCallId: id, input: call.input })
  const reply = call.toolName === 'nodd_declare' ? kernel.declare(call.input as any) : kernel.task(call.input as any)
  const problems = await flush($)
  const final = problems.length === 0 ? reply : { ok: false, text: `${reply.text}\nnodd: ${problems.join('; ')}` }
  kernel.onToolResult({ toolName: call.toolName, toolCallId: id, input: call.input, isError: !final.ok, content: final.text })
  await exportState($)
  return final.ok ? { result: final.text } : { deny: final.text }
}

async function readRawConfig($: any): Promise<{ raw: Record<string, unknown> } | { problem: string }> {
  const text = await readText($, configPath())
  if (text === null || text.trim() === '') return { raw: {} }
  try {
    const raw = JSON.parse(text)
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { raw }
    return { problem: `${configPath()} no es un objeto JSON` }
  } catch (err) {
    return { problem: `${configPath()} no es JSON válido (${err instanceof Error ? err.message : String(err)})` }
  }
}

async function setGates($: any, ids: readonly GateId[], value: boolean): Promise<string | null> {
  const read = await readRawConfig($)
  if ('problem' in read) return `nodd: no toco la config: ${read.problem}. Arreglala a mano primero.`
  const gates = { ...((read.raw.gates as Record<string, unknown> | undefined) ?? {}) }
  for (const id of ids) gates[id] = { enabled: value }
  await $.fs.write(configPath(), `${JSON.stringify(mergeConfig(read.raw, { gates }), null, 2)}\n`)
  return null
}

function gateLines(config: Policy['config']): string[] {
  const policy: Policy = { config, flags: {}, hatches: {} }
  const width = Math.max(...GATE_IDS.map((id) => id.length))
  return GATE_IDS.map((id) => {
    const { enabled: on, source } = resolveFlag(id, policy)
    const where = ENFORCED.includes(id) ? 'activo en Claude Code' : 'pendiente en Claude Code'
    return `  ${id.padEnd(width)}  ${(on ? 'on' : 'off').padEnd(3)}  ${source.padEnd(7)}  ${where}`
  })
}

async function statusText($: any): Promise<string> {
  await stage($, [configPath()])
  const declaration = kernels.get(MAIN)?.state.committed.declaration
  const pending = Object.keys(hatches)
  const lines = [
    `nodd ${enabled ? 'encendido' : 'apagado'} en Claude Code${enabled ? '' : ' (no bloquea nada)'}`,
    `declaración: ${declaration ? `${declaration.intent} · ${declaration.route} · ${declaration.slug}` : 'ninguna'}`,
    'gates (compartidos con pi en ~/.pi/nodd.json):',
    ...gateLines(configGates()),
    `overrides pendientes: ${pending.length ? pending.join(', ') : 'ninguno'}`,
    `último rechazo: ${lastRefusal ? `${lastRefusal.gate} · ${lastRefusal.reason}` : 'ninguno'}`,
  ]
  const raw = await readRawConfig($)
  if ('problem' in raw) lines.push(`ojo: ${raw.problem}; todos los gates quedan en su default hasta arreglarlo`)
  return lines.join('\n')
}

async function command($: any, args: string): Promise<string> {
  const [verb = 'status', ...rest] = args.trim().split(/\s+/).filter((w) => w !== '')
  switch (verb.toLowerCase()) {
    case 'on':
      enabled = true
      await $.store.set('enabled', true)
      await registerTools($)
      await exportState($)
      return `nodd: encendido. Gates activos en Claude Code: ${ENFORCED.join(', ')}.`
    case 'off':
      enabled = false
      await $.store.set('enabled', false)
      await exportState($)
      return 'nodd: apagado. No bloquea nada.'
    case 'status':
      return statusText($)
    case 'gates':
      await stage($, [configPath()])
      return ['nodd gates (gate, modo, quién decide, en Claude Code):', ...gateLines(configGates())].join('\n')
    case 'gate': {
      const [id, value] = rest
      if ((value !== 'on' && value !== 'off') || !id || (id !== 'all' && !isGateId(id))) {
        return `uso: /nodd gate <${GATE_IDS.join('|')}|all> on|off`
      }
      const ids = id === 'all' ? GATE_IDS : [id as GateId]
      const problem = await setGates($, ids, value === 'on')
      if (problem) return problem
      await exportState($)
      return `nodd: gate ${id} ${value === 'on' ? 'prendido' : 'apagado'}.`
    }
    case 'allow': {
      const [gate, ...why] = rest
      if (!gate || !isGateId(gate)) return `uso: /nodd allow <gate> [motivo]. Gates: ${GATE_IDS.join(', ')}`
      if (!ENFORCED.includes(gate)) return `nodd: ${gate} todavía no se aplica en Claude Code, así que no hay nada que saltear.`
      hatches = grantHatch({ config: {}, flags: {}, hatches }, gate, why.join(' '), new Date().toISOString()).hatches
      await saveHatches($)
      await exportState($)
      return `nodd: override de un solo uso para ${gate}. Lo consume el próximo rechazo de ${gate}.`
    }
    default:
      return 'uso: /nodd [status|on|off|gates|gate <id|all> on|off|allow <gate> [motivo]]'
  }
}

export function register(on: any) {
  on('session.start', async ($: any, e: any, next: any) => {
    const r = await next(e)
    await boot($, e?.cwd)
    if (enabled) await registerTools($)
    await $.command
      .register({
        name: 'nodd',
        description: 'NODD en Claude Code: gates authorize, classify y track (apagado por defecto)',
        argumentHint: 'status | on | off | gates | gate <id|all> on|off | allow <gate> [motivo]',
        immediate: true,
      })
      .catch((err: any) => $.ui.log(`nodd: /nodd no registrado: ${err}`, { to: 'debug' }))
    await exportState($)
    return r
  })

  on('command.run', { command: 'nodd' }, async ($: any, e: any) => {
    await boot($)
    return { text: await command($, String(e.args ?? '')) }
  })

  on('agent.spawn', async ($: any, e: any, next: any) => {
    const r = await next(e)
    if (r?.agentId) agents.set(r.agentId, { type: String(e.subagentType ?? ''), parent: e.parentAgentId ?? MAIN })
    return r
  })

  on('tool.call', async ($: any, e: any, next: any) => {
    await boot($)
    const isNodd = e.tool === names.declare || e.tool === names.task
    if (!enabled && !isNodd) return next(e)
    const key: string = e.agentId ?? MAIN
    const id = String(e.tool_use_id ?? `nodd-${Date.now()}`)
    const call = normalizeCall(String(e.tool), e, names)
    if (isNodd) return serve($, kernelFor(key), call, id)
    if (await insideForge($, e, key)) return next(e)
    const kernel = kernelFor(key)

    await stage($, pathsFor(kernel, call))
    if (call.toolName === 'subagent') await resolveCapability($, call.input.agent)
    let decision: { block: true; reason: string } | null = null
    const before = JSON.stringify(hatches)
    try {
      kernel.reloadPolicy()
      decision = kernel.checkCall(call)
    } catch {
      decision = null
    }
    kernel.onToolCall({ toolName: call.toolName, toolCallId: id, input: call.input })
    if (JSON.stringify(hatches) !== before) await saveHatches($)
    await flush($)
    if (decision) {
      kernel.forgetPending(id)
      refusals += 1
      lastRefusal = { gate: gateOfReason(decision.reason), reason: decision.reason, at: new Date().toISOString() }
      await exportState($)
      return { deny: decision.reason }
    }

    let r: any
    try {
      r = await next(e)
    } catch (err) {
      kernel.forgetPending(id)
      throw err
    }
    if (r && typeof r.deny === 'string') kernel.forgetPending(id)
    else kernel.onToolResult({ toolName: call.toolName, toolCallId: id, input: call.input, isError: r?.isError === true, content: String(r?.text ?? '') })
    await exportState($)
    return r
  })
}
