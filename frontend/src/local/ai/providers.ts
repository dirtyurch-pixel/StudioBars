/**
 * Talking to the AI from the phone. Plain-English errors; the key is never put into a message.
 * Claude is called with the official SDK in browser mode (the key is the user's own, kept on this device).
 */
import type Anthropic from '@anthropic-ai/sdk'
import { ApiFail } from '../../apiFail'

export type Reply = { text: string; input_tokens: number; output_tokens: number; stop: string }
const fail = (status: number, code: string, message: string) =>
  new ApiFail(message, { status, code })
const TIMEOUT_MS = 90_000

export function statusError(status: number, message = ''): ApiFail {
  const low = message.toLowerCase()
  if (status === 401)
    return fail(
      502,
      'AI_KEY_REJECTED',
      'The AI did not accept your key. Check it in the AI tab and paste it again.',
    )
  if (status === 402 || low.includes('credit balance') || low.includes('billing'))
    return fail(
      502,
      'AI_BILLING',
      'Your AI account has no credit left or a billing problem. Check your account with the provider.',
    )
  if (status === 403)
    return fail(
      502,
      'AI_FORBIDDEN',
      'Your key is not allowed to use this model. Pick another model or check your key’s permissions.',
    )
  if (status === 404)
    return fail(
      502,
      'AI_MODEL_MISSING',
      'The AI could not find that model. Pick another model in the AI tab.',
    )
  if (status === 429)
    return fail(503, 'AI_BUSY', 'The AI is rate-limiting you. Wait a minute and try again.')
  if (status >= 500)
    return fail(
      503,
      'AI_DOWN',
      'The AI service is having trouble right now. Try again in a moment. Nothing was changed.',
    )
  return fail(502, 'AI_ERROR', 'The AI could not do that request. Nothing was changed.')
}

export async function callAnthropic(
  key: string,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  signal?: AbortSignal,
): Promise<Reply> {
  // the Claude library is loaded only when the AI is actually used, so the app opens fast
  const { default: AnthropicSdk } = await import('@anthropic-ai/sdk')
  const client = new AnthropicSdk({
    apiKey: key,
    dangerouslyAllowBrowser: true,
    timeout: TIMEOUT_MS,
    maxRetries: 1,
  })
  const extra = model.includes('haiku') ? {} : { output_config: { effort: 'low' as const } } // lyrics are short
  let msg: Anthropic.Message
  try {
    msg = await client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        ...extra,
      },
      { signal },
    )
  } catch (e) {
    if (e instanceof AnthropicSdk.APIUserAbortError)
      throw new DOMException('Cancelled', 'AbortError')
    if (e instanceof AnthropicSdk.APIConnectionTimeoutError)
      throw fail(
        504,
        'AI_TIMEOUT',
        'The AI took too long to answer. Nothing was changed. Try again.',
      )
    if (e instanceof AnthropicSdk.APIConnectionError)
      throw fail(
        503,
        'AI_OFFLINE',
        'Could not reach the AI. Check your internet. Your lyrics are safe and nothing was changed.',
      )
    if (e instanceof AnthropicSdk.APIError && typeof e.status === 'number')
      throw statusError(e.status, e.message)
    throw fail(502, 'AI_ERROR', 'The AI had a problem. Nothing was changed. Try again.')
  }
  if (msg.stop_reason === 'refusal')
    throw fail(
      422,
      'AI_REFUSED',
      'The AI declined to answer that. Nothing was changed. Try different wording.',
    )
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  return {
    text,
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    stop: msg.stop_reason ?? '',
  }
}

export async function callOpenAiCompat(
  baseUrl: string,
  key: string | null,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  signal?: AbortSignal,
): Promise<Reply> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  signal?.addEventListener('abort', () => ctl.abort())
  let res: Response
  try {
    res = await fetch(baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers,
      signal: ctl.signal,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.8,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
  } catch {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (ctl.signal.aborted)
      throw fail(
        504,
        'AI_TIMEOUT',
        'The AI took too long to answer. Nothing was changed. Try again.',
      )
    throw fail(
      503,
      'AI_OFFLINE',
      'Could not reach the AI at that address. Is it running, and does it allow this app to call it? Nothing was changed.',
    )
  } finally {
    clearTimeout(t)
  }
  if (!res.ok) throw statusError(res.status)
  try {
    const data = await res.json()
    const choice = data.choices[0]
    return {
      text: choice.message.content || '',
      input_tokens: Number(data.usage?.prompt_tokens) || 0,
      output_tokens: Number(data.usage?.completion_tokens) || 0,
      stop: choice.finish_reason || '',
    }
  } catch {
    throw fail(502, 'BAD_AI_ANSWER', 'The AI sent something unreadable. Nothing was changed.')
  }
}
