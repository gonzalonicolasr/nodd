import { expect, test, describe, mock } from 'claude-code/testing'
import { agentReadOnly, gateOfReason, normalizeCall, stagedFs } from './cc.ts'
import { writeVerified } from './core/io-core.ts'

const DECLARE = 'mcp__nodd__nodd_declare'
const TASK = 'mcp__nodd__nodd_task'
const STATE = '/h/.local/state/nodd/state.json'
const CONFIG = '/h/.pi/nodd.json'

type World = { files: Record<string, string>; ran: string[]; agentsList: any[]; seenAgents: unknown[] }

function world(on: any, seed: { files?: Record<string, string>; store?: Record<string, unknown>; agents?: any[] } = {}): World {
  mock.env(on, { HOME: '/h' })
  mock.store(on, seed.store)
  const w: World = { files: { ...seed.files }, ran: [], agentsList: seed.agents ?? [], seenAgents: [] }
  on('fs.read', async (_$: any, e: any) => {
    if (e.path in w.files) return { value: w.files[e.path] }
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('fs.write', async (_$: any, e: any) => {
    w.files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.list', async (_$: any, e: any) => {
    const prefix = e.path.endsWith('/') ? e.path : `${e.path}/`
    const value = Object.keys(w.files)
      .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .map((p) => ({ name: p.slice(prefix.length), kind: 'file', size: 0, mtimeMs: 0, isLink: false }))
    return { value }
  })
  on('session.cwd', async () => ({ value: '/repo' }))
  on('agent.list', async () => ({ value: w.agentsList }))
  on('tool.register', async (_$: any, e: any) => ({ value: { tool: `mcp__nodd__${e.name}` } }))
  on('command.register', async (_$: any, e: any) => ({ value: { command: e.name } }))
  on('ui.log', async () => ({ value: undefined }))
  on('tool.call', async (_$: any, e: any) => {
    w.ran.push(e.tool)
    w.seenAgents.push(e.agentId)
    return { result: 'ok', text: 'ok' }
  })
  return w
}

const declare = { intent: 'change', route: 'tracked', slug: 'auth', summary: 'login con tokens' }

async function call($: any, input: Record<string, unknown>): Promise<any> {
  return $.tool.call(input as any)
}

async function nodd($: any, args: string): Promise<any> {
  return $.command.run({ command: 'nodd', args } as any)
}

describe('apagado por defecto', () => {
  test('sin /nodd on no bloquea nada', async ($, on) => {
    const w = world(on)
    const r = await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })
    expect(r.deny).toBe(undefined)
    expect(w.ran).toEqual(['Write'])
  })

  test('el status lo dice', async ($, on) => {
    world(on)
    const r: any = await nodd($, '')
    expect(r.text).toContain('apagado')
  })
})

describe('encendido', () => {
  test('un Write sin declaración lo frena classify con el remedio', async ($, on) => {
    const w = world(on)
    await nodd($, 'on')
    const r = await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })
    expect(r.deny).toContain('nodd/classify')
    expect(r.deny).toContain('nodd_declare')
    expect(r.deny).toContain('/nodd-allow classify')
    expect(w.ran).toEqual([])
  })

  test('nodd_declare crea el documento y después el Write pasa', async ($, on) => {
    const w = world(on)
    await nodd($, 'on')
    const d = await call($, { tool: DECLARE, ...declare })
    expect(d.deny).toBe(undefined)
    expect(String(d.result)).toContain('.nodd/auth/feature.md created')
    expect(w.files['/repo/.nodd/auth/feature.md']).toContain('login con tokens')
    const r = await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })
    expect(r.deny).toBe(undefined)
    expect(w.ran).toEqual(['Write'])
  })
})

describe('gates compartidos con pi', () => {
  test('/nodd gate classify off deja pasar el Write y escribe ~/.pi/nodd.json sin perder claves', async ($, on) => {
    const original = {
      models: { implement: 'ag/x' },
      thinking: { implement: 'high' },
      profiles: { rapido: { implement: 'ag/y' } },
      activeProfile: 'rapido',
      gates: { promotion: { enabled: false } },
    }
    const w = world(on, { files: { [CONFIG]: JSON.stringify(original, null, 2) } })
    await nodd($, 'on')
    const off: any = await nodd($, 'gate classify off')
    expect(off.text).toBe('gate classify apagado.')
    const saved = JSON.parse(w.files[CONFIG] ?? 'null')
    expect(saved).toEqual({ ...original, gates: { promotion: { enabled: false }, classify: { enabled: false } } })
    const r = await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })
    expect(r.deny).toBe(undefined)
    expect(w.ran).toEqual(['Write'])
  })

  test('una config rota no se pisa', async ($, on) => {
    const w = world(on, { files: { [CONFIG]: '{ roto' } })
    const r: any = await nodd($, 'gate track off')
    expect(r.text).toContain('no toco la config')
    expect(w.files[CONFIG]).toBe('{ roto')
  })

  test('/nodd gates lista los seis y marca los pendientes en Claude Code', async ($, on) => {
    world(on, { files: { [CONFIG]: JSON.stringify({ gates: { promotion: { enabled: false } } }) } })
    const r: any = await nodd($, 'gates')
    expect(r.text).toMatch(/classify\s+on\s+default\s+activo en Claude Code/)
    expect(r.text).toMatch(/promotion\s+off\s+config\s+pendiente en Claude Code/)
    expect(r.text).toMatch(/delegate\s+on\s+default\s+pendiente en Claude Code/)
  })
})

describe('track', () => {
  test('escribir en .nodd/** lo frena track', async ($, on) => {
    const w = world(on)
    await nodd($, 'on')
    await call($, { tool: DECLARE, ...declare })
    const doc = await call($, { tool: 'Edit', file_path: '/repo/.nodd/auth/feature.md', old_string: 'a', new_string: 'b' })
    expect(doc.deny).toContain('nodd/track')
    expect(doc.deny).toContain('nodd_task')
    const ledger = await call($, { tool: 'Write', file_path: '/repo/.nodd/auth/ledger.json', content: '{}' })
    expect(ledger.deny).toContain('nodd/track')
    expect(w.ran).toEqual([])
  })

  test('nodd_task agrega tareas al documento', async ($, on) => {
    const w = world(on)
    await nodd($, 'on')
    await call($, { tool: DECLARE, ...declare })
    const t = await call($, { tool: TASK, action: 'add', id: 'T1', title: 'el login', slug: 'auth' })
    expect(String(t.result)).toContain('T1 added')
    expect(w.files['/repo/.nodd/auth/feature.md']).toContain('el login')
  })
})

describe('authorize', () => {
  test('con intent read-only, delegar a un escritor se frena y a Explore no', async ($, on) => {
    const w = world(on)
    await nodd($, 'on')
    await call($, { tool: DECLARE, intent: 'read-only', route: 'inline', slug: 'mirar', summary: 's' })
    const writer = await call($, { tool: 'Agent', subagent_type: 'general-purpose', prompt: 'p', description: 'd' })
    expect(writer.deny).toContain('nodd/authorize')
    const reader = await call($, { tool: 'Agent', subagent_type: 'Explore', prompt: 'p', description: 'd' })
    expect(reader.deny).toBe(undefined)
    const write = await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })
    expect(write.deny).toContain('nodd/authorize')
    expect(w.ran).toEqual(['Agent'])
  })

  test('un agente propio sin Write ni Edit cuenta como de sólo lectura', async ($, on) => {
    const agent = '---\nname: lector\ndescription: lee\ntools: Read, Grep, Glob\n---\nprompt'
    world(on, { files: { '/h/.claude/agents/lector.md': agent } })
    await nodd($, 'on')
    await call($, { tool: DECLARE, intent: 'read-only', route: 'inline', slug: 'mirar', summary: 's' })
    const r = await call($, { tool: 'Agent', subagent_type: 'lector', prompt: 'p', description: 'd' })
    expect(r.deny).toBe(undefined)
  })
})

describe('override', () => {
  test('/nodd allow classify deja pasar un solo Write', async ($, on) => {
    const w = world(on)
    await nodd($, 'on')
    const granted: any = await nodd($, 'allow classify urgente')
    expect(granted.text).toContain('override de un solo uso para classify')
    expect((await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })).deny).toBe(undefined)
    expect((await call($, { tool: 'Write', file_path: '/repo/b.ts', content: 'x' })).deny).toContain('nodd/classify')
    expect(w.ran).toEqual(['Write'])
    expect(w.files['/h/.pi/nodd-hatch.json']).toBe(undefined)
  })

  test('no hay override para un gate pendiente en Claude Code', async ($, on) => {
    world(on)
    const r: any = await nodd($, 'allow delegate')
    expect(r.text).toContain('todavía no se aplica')
  })
})

describe('subagentes y forge', () => {
  test('el Write de un agente de fase de forge pasa sin declaración', async ($, on) => {
    const w = world(on, { agents: [{ id: 'a1', type: 'forge:build', status: 'running', description: 'b' }] })
    await nodd($, 'on')
    const r = await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x', agentId: 'a1' })
    expect(r.deny).toBe(undefined)
    expect(w.ran).toEqual(['Write'])
  })

  test('un run de forge en otra sesión no apaga NODD en la principal', async ($, on) => {
    const w = world(on, { files: { '/h/.local/state/forge/state.json': JSON.stringify({ run: { status: 'running' } }) } })
    await nodd($, 'on')
    const r = await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })
    expect(r.deny).toContain('nodd/classify')
    expect(w.ran).toEqual([])
  })

  test('un subagente común sin declaración del padre se frena', async ($, on) => {
    world(on, { agents: [{ id: 'a2', type: 'general-purpose', status: 'running', description: 'g' }] })
    await nodd($, 'on')
    const r = await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x', agentId: 'a2' })
    expect(r.deny).toContain('nodd/classify')
  })

  test('un subagente hereda la declaración del padre y no infla sus contadores', async ($, on) => {
    const w = world(on, { agents: [{ id: 'a2', type: 'general-purpose', status: 'running', description: 'g' }] })
    await nodd($, 'on')
    await call($, { tool: DECLARE, ...declare })
    const before = JSON.parse(w.files[STATE] ?? 'null').counters.toolCalls
    const r = await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x', agentId: 'a2' })
    expect(r.deny).toBe(undefined)
    await call($, { tool: 'Read', file_path: '/repo/b.ts', agentId: 'a2' })
    const state = JSON.parse(w.files[STATE] ?? 'null')
    expect(state.counters.toolCalls).toBe(before)
    expect(state.counters.agents).toBe(1)
  })
})

describe('estado exportado', () => {
  test('state.json sigue el interruptor, la declaración y el último rechazo', async ($, on) => {
    const w = world(on)
    await nodd($, 'on')
    const first = JSON.parse(w.files[STATE] ?? 'null')
    expect(first.enabled).toBe(true)
    expect(first.declaration).toBe(null)
    expect(first.gates.map((g: any) => [g.id, g.enforcedInClaudeCode])).toEqual([
      ['authorize', true],
      ['classify', true],
      ['track', true],
      ['delegate', false],
      ['evidence', false],
      ['promotion', false],
    ])
    await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })
    const refused = JSON.parse(w.files[STATE] ?? 'null')
    expect(refused.lastRefusal.gate).toBe('classify')
    expect(refused.counters.refusals).toBe(1)
    await call($, { tool: DECLARE, ...declare })
    await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })
    const after = JSON.parse(w.files[STATE] ?? 'null')
    expect(after.declaration).toEqual({ slug: 'auth', intent: 'change', route: 'tracked' })
    expect(after.counters.filesWritten).toBe(1)
    expect(after.counters.toolCalls).toBe(2)
    await nodd($, 'off')
    expect(JSON.parse(w.files[STATE] ?? 'null').enabled).toBe(false)
  })
})

describe('piezas', () => {
  test('normalizeCall traduce las tools de Claude Code a las de pi', () => {
    const names = { declare: DECLARE, task: TASK }
    expect(normalizeCall('Write', { tool: 'Write', tool_use_id: 't', file_path: '/a', content: 'x' }, names)).toEqual({ toolName: 'write', input: { file_path: '/a', content: 'x' } })
    expect(normalizeCall('MultiEdit', { file_path: '/a', edits: [] }, names).toolName).toBe('edit')
    expect(normalizeCall('NotebookEdit', { notebook_path: '/n.ipynb' }, names).input.file_path).toBe('/n.ipynb')
    expect(normalizeCall('Agent', { subagent_type: 'Explore', agentId: 'z' }, names)).toEqual({ toolName: 'subagent', input: { subagent_type: 'Explore', agent: 'Explore' } })
    expect(normalizeCall('Task', { subagent_type: 'x' }, names).toolName).toBe('subagent')
    expect(normalizeCall('Bash', { command: 'ls' }, names).toolName).toBe('bash')
    expect(normalizeCall(DECLARE, { slug: 's' }, names).toolName).toBe('nodd_declare')
    expect(normalizeCall(TASK, { slug: 's' }, names).toolName).toBe('nodd_task')
    expect(normalizeCall('WebFetch', { url: 'u' }, names).toolName).toBe('WebFetch')
  })

  test('agentReadOnly lee tools en línea, en lista y ausentes', () => {
    expect(agentReadOnly('---\nname: a\ntools: Read, Grep\n---\n', 'a')).toBe(true)
    expect(agentReadOnly('---\nname: a\ntools: Read, Edit\n---\n', 'A')).toBe(false)
    expect(agentReadOnly('---\nname: a\ntools:\n  - Read\n  - Write\n---\n', 'a')).toBe(false)
    expect(agentReadOnly('---\nname: a\ntools: ["Read", "Glob"]\n---\n', 'a')).toBe(true)
    expect(agentReadOnly('---\nname: a\ndescription: hereda todo\n---\n', 'a')).toBe(false)
    expect(agentReadOnly('---\nname: otro\ntools: Read\n---\n', 'a')).toBe(null)
  })

  test('el fs en escena sostiene la escritura verificada y sólo deja lo que hay que bajar a disco', () => {
    const fs = stagedFs()
    fs.seed('/r/.nodd/s/feature.md', 'viejo\n')
    const result = writeVerified('/r/.nodd/s/feature.md', 'nuevo\n', { fs, expectedPrevious: 'viejo\n', now: () => 'T' })
    expect(result).toEqual({ ok: true })
    expect(fs.drain()).toEqual([['/r/.nodd/s/feature.md', 'nuevo\n']])
    expect(fs.drain()).toEqual([])
    expect(fs.existsSync('/r/.nodd/s/.T.nodd-tmp')).toBe(false)
    expect(() => fs.readFileSync('/no/esta', 'utf8')).toThrow('ENOENT')
  })

  test('el gate sale del prefijo del rechazo', () => {
    expect(gateOfReason('nodd/track: x')).toBe('track')
  })
})
