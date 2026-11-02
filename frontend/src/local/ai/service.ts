/**
 * The phone version's AI co-writer. A port of backend/app/ai/service.py and budget.py.
 * It READS the song and PROPOSES lines; it never writes to songs. Your key is kept in this browser on this device,
 * is never shown back (only its last 4 characters) and is only ever sent to the AI company you chose.
 */
import { ApiFail } from '../../apiFail'
import { newId } from '../../editor/content'
import type { AiPrepared, AiResult, AiStatus } from '../../types'
import { loadDictionary } from '../data'
import { db, getSong, nowIso } from '../localApi'
import { classify } from '../phonetics/engine'
import { Resolver, analyzeLines, hasPhones, tokenize } from '../phonetics/words'
import { exclusive } from '../store'
import {
  MODELS,
  PERSONAS,
  TASKS,
  TYPICAL_IN,
  TYPICAL_OUT,
  build,
  cost,
  estimateTokens,
  prices,
  promptHash,
  type AiReq,
  type Built,
} from './prompts'
import { callAnthropic, callOpenAiCompat, type Reply } from './providers'
import { parseLines, parseNotes } from './validate'

const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new ApiFail(message, { status, code }), extra)
const PROVIDERS = ['anthropic', 'openai_compat'] as const
const PROVIDER_LABELS = {
  anthropic: 'Claude (Anthropic)',
  openai_compat: 'Other (OpenAI-compatible server)',
}
const DEFAULTS: Record<string, string> = {
  ai_enabled: '0',
  ai_provider: 'anthropic',
  ai_model: 'claude-opus-5-5',
  ai_base_url: '',
  ai_cap_usd: '5.00',
  ai_price_in: '0',
  ai_price_out: '0',
}
const KEY_OK = /^[\x21-\x7e]{8,400}$/

async function get(k: string): Promise<string> {
  return (await db().get<{ value: string }>('settings', k))?.value ?? DEFAULTS[k] ?? ''
}
const put = (k: string, v: string) => db().put('settings', k, { value: v })

async function settings() {
  return {
    enabled: (await get('ai_enabled')) === '1',
    provider: (await get('ai_provider')) as AiStatus['provider'],
    model: await get('ai_model'),
    base_url: await get('ai_base_url'),
    cap_usd: parseFloat(await get('ai_cap_usd')),
    price_in: parseFloat(await get('ai_price_in')),
    price_out: parseFloat(await get('ai_price_out')),
  }
}
type Settings = Awaited<ReturnType<typeof settings>>

async function getKey(provider: string): Promise<string | null> {
  return (await db().get<{ value: string }>('settings', `ai_key_${provider}`))?.value || null
}
const hint = (k: string) => (k.length >= 8 ? '…' + k.slice(-4) : '…')

// ---------------------------------------------------------------- money

const month = (d = new Date()) => d.toISOString().slice(0, 7)
type Usage = {
  id: string
  ts: string
  month: string
  provider: string
  model: string
  task: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

async function monthTotals() {
  const m = month()
  const rows = (await db().all<Usage>('ai_usage')).filter((r) => r.month === m)
  const cap = parseFloat(await get('ai_cap_usd'))
  const spent = Math.round(rows.reduce((n, r) => n + r.cost_usd, 0) * 1e6) / 1e6
  return {
    month: m,
    spent_usd: spent,
    requests: rows.length,
    cap_usd: cap,
    remaining_usd: Math.round(Math.max(0, cap - spent) * 1e6) / 1e6,
  }
}

async function checkBudget(worst: number) {
  const t = await monthTotals()
  if (t.spent_usd + worst > t.cap_usd + 1e-9)
    throw fail(
      402,
      'BUDGET_REACHED',
      `This would go over your monthly AI limit ($${t.cap_usd.toFixed(2)}; used $${t.spent_usd.toFixed(2)} so far). Nothing was sent. You can raise the limit in the AI tab.`,
    )
}

class Limiter {
  tokens: number
  last = Date.now()
  constructor(
    private capacity = 6,
    private perSecond = 0.5,
  ) {
    this.tokens = capacity
  }
  allow() {
    const t = Date.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.perSecond)
    this.last = t
    if (this.tokens >= 1) {
      this.tokens -= 1
      return true
    }
    return false
  }
}
const limiter = new Limiter()

// ---------------------------------------------------------------- status and settings

const ready = async (s: Settings) =>
  s.enabled &&
  (s.provider === 'anthropic' ? Boolean(await getKey('anthropic')) : Boolean(s.base_url))

export async function status(): Promise<AiStatus> {
  const s = await settings()
  const key = await getKey(s.provider)
  return {
    ...s,
    key: { configured: Boolean(key), source: key ? 'file' : null, hint: key ? hint(key) : null },
    usage: await monthTotals(),
    models: Object.entries(MODELS).map(([id, m]) => ({
      id,
      label: m.label,
      typical_request_usd: Math.round(cost(TYPICAL_IN, TYPICAL_OUT, m.in, m.out) * 1e4) / 1e4,
    })),
    providers: Object.entries(PROVIDER_LABELS).map(([id, label]) => ({ id, label })),
    tasks: Object.entries(TASKS).map(([id, t]) => ({
      id: id as AiStatus['tasks'][number]['id'],
      label: t.label,
      kind: t.kind,
      needs_line: t.target,
      needs_rhyme: Boolean(t.rhyme),
      whole_song: Boolean(t.whole),
    })),
    personas: Object.entries(PERSONAS).map(([id, p]) => ({ id, label: p.label, text: p.text })),
    ready: await ready(s),
    disclosure:
      'When you press Send, the text shown in “What will be sent” (your title, genres and the lines of the sections listed) goes over the internet to the AI company you chose. Nothing is sent before you press Send. Your key stays in this browser on this device.',
  }
}

export async function updateSettings(data: Partial<Settings>): Promise<AiStatus> {
  const cur = await settings()
  const provider = data.provider ?? cur.provider
  if (!(PROVIDERS as readonly string[]).includes(provider))
    throw fail(422, 'BAD_SETTING', 'Unknown AI provider.')
  const model = (data.model ?? cur.model ?? '').trim()
  let baseUrl = (data.base_url ?? cur.base_url ?? '').trim()
  if (provider === 'anthropic') {
    if (!MODELS[model]) throw fail(422, 'BAD_SETTING', 'Pick one of the listed Claude models.')
    baseUrl = ''
  } else {
    if (!model || model.length > 100)
      throw fail(422, 'BAD_SETTING', 'Enter the model name your AI server uses.')
    if (baseUrl && !/^https?:\/\//.test(baseUrl))
      throw fail(422, 'BAD_SETTING', 'The server address must start with http:// or https://')
  }
  const cap = data.cap_usd ?? cur.cap_usd
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0 || cap > 1000)
    throw fail(422, 'BAD_SETTING', 'The monthly limit must be between $0 and $1000.')
  const pi = data.price_in ?? cur.price_in
  const po = data.price_out ?? cur.price_out
  if (![pi, po].every((x) => typeof x === 'number' && x >= 0 && x <= 1000))
    throw fail(422, 'BAD_SETTING', 'Prices must be numbers, 0 or more.')
  const enabled = data.enabled ?? cur.enabled
  await exclusive(async () => {
    await put('ai_enabled', enabled ? '1' : '0')
    await put('ai_provider', provider)
    await put('ai_model', model)
    await put('ai_base_url', baseUrl)
    await put('ai_cap_usd', cap.toFixed(2))
    await put('ai_price_in', String(pi))
    await put('ai_price_out', String(po))
  })
  return status()
}

export async function setKey(provider: string, key: string): Promise<AiStatus> {
  if (!(PROVIDERS as readonly string[]).includes(provider))
    throw fail(422, 'BAD_KEY', 'Unknown provider.')
  const k = key.trim()
  if (!KEY_OK.test(k))
    throw fail(
      422,
      'BAD_KEY',
      'That does not look like an API key (it should be one long line of letters and numbers, no spaces).',
    )
  await put(`ai_key_${provider}`, k)
  return status()
}

export async function deleteKey(provider: string): Promise<AiStatus> {
  if (!(PROVIDERS as readonly string[]).includes(provider))
    throw fail(422, 'BAD_SETTING', 'Unknown AI provider.')
  await db().del('settings', `ai_key_${provider}`)
  return status()
}

// ---------------------------------------------------------------- prepare and send

type Plan = Built & {
  est_in: number
  est_cost: number
  worst_cost: number
  prices: [number, number]
}

async function requireReady(): Promise<Settings> {
  const s = await settings()
  if (!s.enabled) throw fail(403, 'AI_OFF', 'AI is switched off. Turn it on in the AI tab first.')
  if (!(await ready(s)))
    throw fail(409, 'AI_NOT_SETUP', 'Add your AI key (or server address) in the AI tab first.')
  return s
}

async function plan(req: AiReq) {
  const s = await requireReady()
  const song = await getSong(req.song_id)
  const b = build(song, req)
  const [pi, po] = prices(s.model, s.price_in, s.price_out)
  const estIn = estimateTokens(b.system + b.user)
  const p: Plan = {
    ...b,
    est_in: estIn,
    est_cost: cost(estIn, Math.floor(b.max_tokens / 2), pi, po),
    worst_cost: cost(estIn, b.max_tokens, pi, po),
    prices: [pi, po],
  }
  return { s, song, p }
}

const round5 = (x: number) => Math.round(x * 1e5) / 1e5

export async function prepare(req: AiReq): Promise<AiPrepared> {
  const { s, p } = await plan(req)
  const t = await monthTotals()
  return {
    hash: await promptHash(s.provider, s.model, s.base_url, p),
    provider: s.provider,
    model: s.model,
    system: p.system,
    user: p.user,
    sent: p.sent,
    est_input_tokens: p.est_in,
    max_output_tokens: p.max_tokens,
    est_cost_usd: round5(p.est_cost),
    worst_cost_usd: round5(p.worst_cost),
    over_budget: t.spent_usd + p.worst_cost > t.cap_usd + 1e-9,
    usage: t,
  }
}

async function call(
  s: Settings,
  p: { system: string; user: string; max_tokens: number },
  signal?: AbortSignal,
): Promise<Reply> {
  if (s.provider === 'anthropic')
    return callAnthropic(
      (await getKey('anthropic')) ?? '',
      s.model,
      p.system,
      p.user,
      p.max_tokens,
      signal,
    )
  return callOpenAiCompat(
    s.base_url,
    await getKey('openai_compat'),
    s.model,
    p.system,
    p.user,
    p.max_tokens,
    signal,
  )
}

async function spend(s: Settings, task: string, reply: Reply, est: number, pr: [number, number]) {
  const inT = reply.input_tokens || est
  const outT = reply.output_tokens || estimateTokens(reply.text)
  const c = cost(inT, outT, pr[0], pr[1])
  const row: Usage = {
    id: newId(),
    ts: nowIso(),
    month: month(),
    provider: s.provider,
    model: s.model,
    task,
    input_tokens: inT,
    output_tokens: outT,
    cost_usd: c,
  }
  await db().put('ai_usage', row.id, row)
  return c
}

export async function suggest(
  req: AiReq,
  ackHash: string,
  signal?: AbortSignal,
): Promise<AiResult> {
  const { s, song, p } = await plan(req)
  if ((await promptHash(s.provider, s.model, s.base_url, p)) !== ackHash)
    throw fail(
      409,
      'CONTEXT_CHANGED',
      'The song changed since you looked at “What will be sent”. Please check it again.',
    )
  if (!limiter.allow())
    throw fail(
      429,
      'SLOW_DOWN',
      'That was a lot of requests very quickly. Wait a few seconds and try again.',
    )
  await checkBudget(p.worst_cost)
  const reply = await call(s, p, signal)
  const c = await spend(s, req.task, reply, p.est_in, p.prices)
  const usage = {
    input_tokens: reply.input_tokens,
    output_tokens: reply.output_tokens,
    cost_usd: round5(c),
  }
  const totals = await monthTotals()
  const base = { kind: p.kind, model: s.model, usage, month: totals }
  const bad = () =>
    fail(
      502,
      'BAD_AI_ANSWER',
      'The AI’s answer could not be used, so nothing was changed. You were charged for it; try again.',
    )
  if (p.kind === 'notes') {
    const notes = parseNotes(reply.text)
    if (!notes.length) throw bad()
    return { ...base, notes, suggestions: [] }
  }
  const lines = new Map(song.sections.flatMap((x) => x.lines.map((l) => [l.id, l] as const)))
  const cands = parseLines(reply.text, new Set([...lines.values()].map((l) => l.text)), p.count)
  if (!cands.length) throw bad()
  const refId = p.rhyme_id || p.target_id
  const refText = refId ? lines.get(refId)!.text : null
  // numbers worked out HERE, never taken from the AI
  const d = await loadDictionary()
  const r = new Resolver(
    d,
    new Map(
      (await db().all<{ word: string; phones: string }>('custom')).map((x) => [
        x.word,
        x.phones.split(' '),
      ]),
    ),
  )
  const res = analyzeLines(
    cands.map((x) => x.text),
    r,
  ).lines
  let refPh: readonly string[] | null = null
  if (refText) {
    const toks = tokenize(refText)
    if (toks.length) {
      const info = r.lookup(toks[toks.length - 1].norm)
      refPh = hasPhones(info) ? info.prons[0].phones : null
    }
  }
  const out = cands.map((c2, i) => {
    let quality: string | null = null
    const toks = tokenize(c2.text)
    if (refPh && toks.length) {
      const info = r.lookup(toks[toks.length - 1].norm)
      if (hasPhones(info)) quality = classify(refPh, info.prons[0].phones)
    }
    const id = newId()
    void db().put('ai_suggestions', id, {
      id,
      song_id: req.song_id,
      task: req.task,
      text: c2.text,
      reason: c2.reason,
      created_at: nowIso(),
      accepted_at: null,
    })
    return { id, ...c2, syllables: res[i].syllables, rhymes_with_target: quality }
  })
  return {
    ...base,
    suggestions: out as AiResult['suggestions'],
    notes: [],
    target_line_id: p.target_id,
  }
}

export async function accept(id: string) {
  const row = await db().get<{ accepted_at: string | null }>('ai_suggestions', id)
  if (!row) throw fail(404, 'NOT_FOUND', 'Suggestion not found.')
  if (!row.accepted_at) await db().put('ai_suggestions', id, { ...row, accepted_at: nowIso() })
  return { ok: true }
}

export async function testConnection() {
  const s = await requireReady()
  const p = {
    system: 'Reply with the single word OK.',
    user: 'Reply with the single word OK.',
    max_tokens: 20,
  }
  const [pi, po] = prices(s.model, s.price_in, s.price_out)
  const est = estimateTokens(p.user + p.user)
  await checkBudget(cost(est, p.max_tokens, pi, po))
  if (!limiter.allow()) throw fail(429, 'SLOW_DOWN', 'Wait a few seconds and try again.')
  const reply = await call(s, p)
  await spend(s, 'test', reply, est, [pi, po])
  return { ok: true, month: await monthTotals() }
}
