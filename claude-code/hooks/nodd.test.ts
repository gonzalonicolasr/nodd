import { expect, test, describe, mock } from 'claude-code/testing'
import { agentReadOnly, gateOfReason, normalizeCall, stagedFs } from './cc.ts'
import { writeVerified } from './core/io-core.ts'

const DECLARE = 'mcp__nodd__nodd_declare'
const TASK = 'mcp__nodd__nodd_task'
const STATE = '/h/.local/state/nodd/sessions/s1.json'
const CONFIG = '/h/.pi/nodd.json'

type World = { files: Record<string, string>; ran: string[]; agentsList: any[]; seenAgents: unknown[]; submitted: any[]; cwd: string; repo: string | null; registered: string[]; schemas: Record<string, any>; store: Record<string, unknown>; respond?: (e: any) => any }

function world(on: any, seed: { files?: Record<string, string>; store?: Record<string, unknown>; agents?: any[] } = {}): World {
  mock.env(on, { HOME: '/h' })
  const w: World = { files: { ...seed.files }, ran: [], agentsList: seed.agents ?? [], seenAgents: [], submitted: [], cwd: '/repo', repo: null, registered: [], schemas: {}, store: { ...seed.store } }
  on('store.get', async (_$: any, e: any) => ({ value: w.store[e.key] }))
  on('store.set', async (_$: any, e: any) => {
    w.store[e.key] = e.value
    return { value: undefined }
  })
  on('ui.invalidate', async () => ({ value: undefined }))
  on('prompt.submit', async (_$: any, e: any) => {
    w.submitted.push(e)
    return { text: e.text, context: e.context }
  })
  on('prompt.context', async (_$: any, e: any) => ({ blocks: e.blocks }))
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
  on('session.cwd', async () => ({ value: w.cwd }))
  on('session.id', async () => ({ value: 's1' }))
  on('session.repo', async () => ({ value: w.repo === null ? null : { root: w.repo, remote: null, internal: false } }))
  on('agent.list', async () => ({ value: w.agentsList }))
  on('tool.register', async (_$: any, e: any) => {
    w.registered.push(e.name)
    w.schemas[e.name] = e
    return { value: { tool: `mcp__nodd__${e.name}` } }
  })
  on('command.register', async (_$: any, e: any) => ({ value: { command: e.name } }))
  on('ui.log', async () => ({ value: undefined }))
  on('tool.call', async (_$: any, e: any) => {
    w.ran.push(e.tool)
    w.seenAgents.push(e.agentId)
    return w.respond?.(e) ?? { result: 'ok', text: 'ok' }
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
    expect(r.deny).toContain('/nodd allow classify')
    expect(r.deny).not.toContain('/nodd-allow')
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

const prompt = (text: string, kind = 'composer', turnId?: string) => ({ text, wait: false, origin: { kind }, ...(turnId ? { turnId } : {}) })

describe('una declaración por pedido', () => {
  test('un pedido nuevo del usuario borra la declaración anterior y le recuerda al modelo', async ($, on) => {
    const w = world(on)
    await nodd($, 'on')
    await call($, { tool: DECLARE, ...declare })
    expect((await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })).deny).toBe(undefined)
    await $.prompt.submit(prompt('ahora otra cosa') as any)
    const sent = w.submitted.at(-1)
    expect(sent.text).toBe('ahora otra cosa')
    expect(sent.context.join('\n')).toContain('nodd_declare')
    expect(JSON.parse(w.files[STATE] ?? 'null').declaration).toBe(null)
    expect((await call($, { tool: 'Write', file_path: '/repo/b.ts', content: 'x' })).deny).toContain('nodd/classify')
  })

  test('una notificación o un mensaje escrito durante el turno no son un pedido nuevo', async ($, on) => {
    const w = world(on)
    await nodd($, 'on')
    await call($, { tool: DECLARE, ...declare })
    await $.prompt.submit(prompt('terminó el agente', 'task-notification') as any)
    await $.prompt.submit(prompt('y también esto', 'composer', 'turn-1') as any)
    expect(w.submitted.every((e) => e.context === undefined)).toBe(true)
    expect((await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })).deny).toBe(undefined)
  })

  test('apagado no toca el pedido ni el contexto', async ($, on) => {
    const w = world(on)
    await $.prompt.submit(prompt('hola') as any)
    expect(w.submitted.at(-1).context).toBe(undefined)
    const ctx: any = await $.prompt.context({ blocks: [] } as any)
    expect(ctx.blocks).toEqual([])
  })

  test('prendido, la conversación arranca con el protocolo', async ($, on) => {
    world(on)
    await nodd($, 'on')
    const ctx: any = await $.prompt.context({ blocks: [{ name: 'currentDate', text: 'hoy' }] } as any)
    expect(ctx.blocks.map((b: any) => b.name)).toEqual(['currentDate', 'nodd'])
    const text = ctx.blocks[1].text
    for (const word of ['nodd_declare', 'inline', 'tracked', 'forge', 'nodd_task', '/nodd allow']) expect(text).toContain(word)
  })
})

describe('una sesión, su estado', () => {
  test('/nodd on en otra sesión llega a esta sin reiniciarla', async ($, on) => {
    const w = world(on)
    expect((await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })).deny).toBe(undefined)
    w.store.enabled = true
    expect((await call($, { tool: 'Write', file_path: '/repo/b.ts', content: 'x' })).deny).toContain('nodd/classify')
    expect(w.registered).toContain('nodd_declare')
    w.store.enabled = false
    expect((await call($, { tool: 'Write', file_path: '/repo/c.ts', content: 'x' })).deny).toBe(undefined)
  })

  test('si otra sesión apaga NODD, el estado de esta sesión lo refleja', async ($, on) => {
    const w = world(on)
    await nodd($, 'on')
    expect(JSON.parse(w.files[STATE] ?? 'null').enabled).toBe(true)
    w.files['/h/.local/state/nodd/switch.json'] = JSON.stringify({ enabled: false, at: 't' })
    await call($, { tool: 'Read', file_path: '/repo/a.ts' })
    expect(JSON.parse(w.files[STATE] ?? 'null').enabled).toBe(false)
  })

  test('el estado se exporta a un archivo de esta sesión y no a uno compartido', async ($, on) => {
    const w = world(on)
    await nodd($, 'on')
    const state = JSON.parse(w.files[STATE] ?? 'null')
    expect(state.sessionId).toBe('s1')
    expect(state.enabled).toBe(true)
    expect(w.files['/h/.local/state/nodd/state.json']).toBe(undefined)
  })

  test('el documento va a la raíz del repo donde se declara, no a donde arrancó la sesión', async ($, on) => {
    const w = world(on)
    w.cwd = '/h'
    await nodd($, 'on')
    w.cwd = '/h/proyecto/pkg'
    w.repo = '/h/proyecto'
    await call($, { tool: DECLARE, ...declare })
    expect(w.files['/h/proyecto/.nodd/auth/feature.md']).toContain('login con tokens')
    expect(Object.keys(w.files).some((p) => p.startsWith('/h/.nodd/'))).toBe(false)
    expect((await call($, { tool: 'Write', file_path: '/h/proyecto/pkg/a.ts', content: 'x' })).deny).toBe(undefined)
  })

  test('fuera de un repo, el documento va a la carpeta donde se declara', async ($, on) => {
    const w = world(on)
    await nodd($, 'on')
    w.cwd = '/tmp/suelto'
    await call($, { tool: DECLARE, ...declare })
    expect(w.files['/tmp/suelto/.nodd/auth/feature.md']).toContain('login con tokens')
  })
})

describe('costo en tokens', () => {
  test('las tools del mod son cortas, sin comandos de pi, y piden sólo lo obligatorio para inline', async ($, on) => {
    const w = world(on)
    await nodd($, 'on')
    const declare = w.schemas.nodd_declare
    const task = w.schemas.nodd_task
    const size = JSON.stringify(declare).length + JSON.stringify(task).length
    expect(size).toBeLessThan(1500)
    expect(JSON.stringify(declare)).not.toContain('/nodd-promote')
    expect(declare.description).toContain('inline')
    expect(declare.inputSchema.required).toEqual(['slug'])
    expect(Object.keys(declare.inputSchema.properties).sort()).toEqual(['constraints', 'files', 'intent', 'problem', 'route', 'runner', 'scope', 'slug', 'summary', 'tdd', 'title'])
    expect(task.inputSchema.required).toEqual(['action', 'id', 'slug'])
  })

  test('el recordatorio por pedido es una línea corta', async ($, on) => {
    const w = world(on)
    await nodd($, 'on')
    await $.prompt.submit(prompt('hola') as any)
    const reminder = w.submitted.at(-1).context.at(-1)
    expect(reminder).toContain('nodd_declare')
    expect(reminder.length).toBeLessThan(90)
  })
})

describe('scratchpad y continuar', () => {
  const SCRATCH = '/tmp/claude-1000/-repo/s1/scratchpad/notas.md'

  test('escribir en el scratchpad de la sesión no pide declaración, ni siquiera en read-only', async ($, on) => {
    const w = world(on)
    await nodd($, 'on')
    expect((await call($, { tool: 'Write', file_path: SCRATCH, content: 'x' })).deny).toBe(undefined)
    expect((await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })).deny).toContain('nodd/classify')
    await call($, { tool: DECLARE, intent: 'read-only', route: 'inline', slug: 'mirar', summary: 's' })
    expect((await call($, { tool: 'Edit', file_path: SCRATCH, old_string: 'x', new_string: 'y' })).deny).toBe(undefined)
    expect(w.ran).toEqual(['Write', 'Edit'])
  })

  test('el scratchpad de otra sesión no cuenta', async ($, on) => {
    world(on)
    await nodd($, 'on')
    expect((await call($, { tool: 'Write', file_path: '/tmp/claude-1000/-repo/otra/scratchpad/a.md', content: 'x' })).deny).toContain('nodd/classify')
  })

  test('para seguir con la feature del pedido anterior alcanza con el slug', async ($, on) => {
    const w = world(on)
    await nodd($, 'on')
    await call($, { tool: DECLARE, ...declare, runner: 'npm test', tdd: 'strict' })
    await $.prompt.submit(prompt('seguí') as any)
    const again = await call($, { tool: DECLARE, slug: 'auth' })
    expect(again.deny).toBe(undefined)
    expect((await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })).deny).toBe(undefined)
    expect(JSON.parse(w.files[STATE] ?? 'null').declaration).toEqual({ slug: 'auth', intent: 'change', route: 'tracked' })
  })

  test('una feature nueva con sólo el slug se rechaza diciendo qué falta', async ($, on) => {
    world(on)
    await nodd($, 'on')
    const r = await call($, { tool: DECLARE, slug: 'nueva' })
    expect(r.deny).toContain('intent, route and summary')
    expect((await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })).deny).toContain('nodd/classify')
  })
})

describe('evidence en Claude Code', () => {
  const tracked = { ...declare, runner: 'npm test', files: ['/repo/a.ts'] }
  const bash = (respond: (e: any) => any) => (e: any) => (e.tool === 'Bash' ? respond(e) : undefined)

  async function setup($: any, on: any) {
    const w = world(on)
    await nodd($, 'on')
    await call($, { tool: DECLARE, ...tracked })
    await call($, { tool: TASK, action: 'add', id: 'T1', title: 'login', slug: 'auth' })
    await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })
    return w
  }

  test('una corrida roja no tilda, una verde después de escribir sí', async ($, on) => {
    const w = await setup($, on)
    w.respond = bash(() => ({ isError: true, result: 'Exit code 1\nFAIL 2 tests', text: 'Exit code 1\nFAIL 2 tests' }))
    await call($, { tool: 'Bash', command: 'npm test' })
    const red = await call($, { tool: TASK, action: 'check', id: 'T1', slug: 'auth' })
    expect(red.deny).toContain('exit 1')
    w.respond = bash(() => ({ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }))
    await call($, { tool: 'Bash', command: 'npm test' })
    const green = await call($, { tool: TASK, action: 'check', id: 'T1', slug: 'auth' })
    expect(green.deny).toBe(undefined)
    expect(w.files['/repo/.nodd/auth/feature.md']).toContain('observed: `npm test` → success')
  })

  test('un npm test con | tail no tilda aunque salga bien', async ($, on) => {
    const w = await setup($, on)
    w.respond = bash(() => ({ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }))
    await call($, { tool: 'Bash', command: 'npm test 2>&1 | tail -3' })
    expect((await call($, { tool: TASK, action: 'check', id: 'T1', slug: 'auth' })).deny).toContain('exit status')
  })

  test('una corrida pasada a segundo plano o interrumpida no cuenta como verde', async ($, on) => {
    const w = await setup($, on)
    w.respond = bash(() => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' }, text: 'Command running in background' }))
    await call($, { tool: 'Bash', command: 'npm test' })
    expect((await call($, { tool: TASK, action: 'check', id: 'T1', slug: 'auth' })).deny).toContain('nodd/evidence')
    w.respond = bash(() => ({ result: { stdout: '', stderr: '', interrupted: true }, text: '' }))
    await call($, { tool: 'Bash', command: 'npm test' })
    expect((await call($, { tool: TASK, action: 'check', id: 'T1', slug: 'auth' })).deny).toContain('nodd/evidence')
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
    expect(r.text).toMatch(/evidence\s+on\s+default\s+activo en Claude Code/)
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
      ['evidence', true],
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

test('el interruptor vive en un archivo compartido por todas las sesiones', async ($, on) => {
  const w = world(on, { store: { enabled: true } })
  await nodd($, 'off')
  expect(JSON.parse(w.files['/h/.local/state/nodd/switch.json']).enabled).toBe(false)
  w.files['/h/.local/state/nodd/switch.json'] = JSON.stringify({ enabled: true })
  const r = await call($, { tool: 'Write', file_path: '/repo/a.ts', content: 'x' })
  expect(r.deny).toContain('nodd/classify')
  w.files['/h/.local/state/nodd/switch.json'] = JSON.stringify({ enabled: false })
  const ok = await call($, { tool: 'Write', file_path: '/repo/b.ts', content: 'x' })
  expect(ok.deny).toBe(undefined)
})
