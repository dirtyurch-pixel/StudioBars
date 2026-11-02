import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiFail } from '../../apiFail'
import * as L from '../localApi'
import { MemoryStore } from '../store'
import { cost, estimateTokens, prices } from './prompts'

const call = vi.hoisted(() => vi.fn())
vi.mock('./providers', async (orig) => ({
  ...(await orig<typeof import('./providers')>()),
  callAnthropic: call,
}))
import * as S from './service'

let store: MemoryStore
const MSG = 'Reply with the single word OK.'
const worst = () => {
  const [pi, po] = prices('claude-opus-5-5', 0, 0)
  return cost(estimateTokens(MSG + MSG), 20, pi, po)
}
const usage = () => store.all<{ cost_usd: number; task: string }>('ai_usage')

beforeEach(async () => {
  store = new MemoryStore()
  L.useStore(store)
  call.mockReset()
  await S.setKey('anthropic', 'sk-ant-test-0000006789')
  await S.updateSettings({ enabled: true, cap_usd: 1, model: 'claude-opus-5-5' })
})

describe('the monthly AI limit', () => {
  it('two requests at once cannot both squeeze under the limit', async () => {
    // already spent almost everything: room for ONE more request only
    await store.put('ai_usage', 'old', {
      id: 'old',
      ts: new Date().toISOString(),
      month: new Date().toISOString().slice(0, 7),
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      task: 'earlier',
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 1 - worst() * 1.5,
    })
    call.mockImplementation(
      () =>
        new Promise((r) =>
          setTimeout(() => r({ text: 'OK', input_tokens: 10, output_tokens: 2 }), 30),
        ),
    )
    const res = await Promise.allSettled([S.testConnection(), S.testConnection()])
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const no = res.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect((no.reason as ApiFail).code).toBe('BUDGET_REACHED')
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('a request that is cut off stays counted (it may have been charged)', async () => {
    call.mockRejectedValue(new ApiFail('slow', { status: 504, code: 'AI_TIMEOUT' }))
    await expect(S.testConnection()).rejects.toThrow()
    const rows = await usage()
    expect(rows).toHaveLength(1)
    expect(rows[0].cost_usd).toBeGreaterThan(0)
    expect(rows[0].task).toMatch(/not confirmed/)
  })

  it('a request the AI company refused up front is not counted', async () => {
    call.mockRejectedValue(new ApiFail('bad key', { status: 502, code: 'AI_KEY_REJECTED' }))
    await expect(S.testConnection()).rejects.toThrow()
    expect(await usage()).toHaveLength(0)
  })

  it('a finished request records its real cost, not the reservation', async () => {
    call.mockResolvedValue({ text: 'OK', input_tokens: 12, output_tokens: 1 })
    await S.testConnection()
    const rows = await usage()
    expect(rows).toHaveLength(1)
    expect(rows[0].task).toBe('test')
    expect(rows[0].cost_usd).toBeLessThanOrEqual(worst())
  })
})

describe('the AI key', () => {
  it('can be kept only until the app is closed (never written to storage)', async () => {
    await S.deleteKey('anthropic')
    const st = await S.setKey('anthropic', 'sk-ant-session-0000001234', false)
    expect(st.key).toMatchObject({ configured: true, source: 'session', hint: '…1234' })
    const all = JSON.stringify(await store.all('settings'))
    expect(all).not.toContain('sk-ant-session')
    await S.setKey('anthropic', 'sk-ant-saved-0000005678', true)
    expect((await S.status()).key.source).toBe('file')
  })
})
