import { useState } from 'react'
import * as api from '../api'
import { ApiFail, LOCAL } from '../api'
import type { AiStatus } from '../types'

type Props = { status: AiStatus; onStatus: (s: AiStatus) => void; onClose?: () => void }

const money = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`

export function AiSetup({ status, onStatus, onClose }: Props) {
  const [key, setKey] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [cap, setCap] = useState(String(status.cap_usd))
  const [baseUrl, setBaseUrl] = useState(status.base_url)
  const [model, setModel] = useState(status.provider === 'anthropic' ? '' : status.model)
  const [priceIn, setPriceIn] = useState(String(status.price_in))
  const [priceOut, setPriceOut] = useState(String(status.price_out))
  const claude = status.provider === 'anthropic'

  async function run(fn: () => Promise<AiStatus | void>, ok?: string) {
    setBusy(true)
    setMsg(null)
    try {
      const s = await fn()
      if (s) onStatus(s)
      if (ok) setMsg({ ok: true, text: ok })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiFail ? e.message : 'Something went wrong.' })
    } finally {
      setBusy(false)
    }
  }

  const saveKey = () =>
    run(
      async () => {
        const s = await api.putAiKey(status.provider, key)
        setKey('') // the key is never kept in the page after it is saved
        return s
      },
      LOCAL ? 'Key saved on this device.' : 'Key saved on this computer.',
    )

  const saveSettings = (extra: Parameters<typeof api.putAiSettings>[0] = {}) =>
    run(() => {
      const c = Number(cap)
      const base: Parameters<typeof api.putAiSettings>[0] = {
        cap_usd: Number.isFinite(c) ? c : 5,
        ...extra,
      }
      if (!claude) {
        Object.assign(base, {
          base_url: baseUrl,
          model,
          price_in: Number(priceIn) || 0,
          price_out: Number(priceOut) || 0,
        })
      }
      return api.putAiSettings(base)
    }, 'Saved.')

  const test = () =>
    run(async () => {
      await api.aiTest()
      setMsg({ ok: true, text: 'Connected. The AI answered.' })
      return api.getAiStatus()
    })

  return (
    <div className="ai-setup" aria-label="AI setup">
      <h3 className="ai-h">AI co-writer setup</h3>
      <p className="muted">
        The AI only <strong>suggests</strong>. It never changes your lyrics by itself, and it can
        never touch a locked line.
      </p>

      <label className="ai-field">
        <span>Which AI?</span>
        <select
          className="input"
          value={status.provider}
          disabled={busy}
          onChange={(e) =>
            run(() =>
              api.putAiSettings({
                provider: e.target.value,
                model: e.target.value === 'anthropic' ? 'claude-opus-5-5' : model || 'llama3',
              }),
            )
          }
        >
          {status.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {claude ? (
        <>
          <div className="ai-field">
            <label htmlFor="ai-key">Your Claude API key</label>
            {status.key.configured ? (
              <p className="muted">
                A key is saved{' '}
                {status.key.source === 'env'
                  ? '(from the computer’s settings)'
                  : LOCAL
                    ? 'on this device'
                    : 'on this computer'}
                : <code>{status.key.hint}</code>.{' '}
                {status.key.source === 'file' && (
                  <button
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => run(() => api.deleteAiKey(status.provider), 'Key removed.')}
                  >
                    Remove key
                  </button>
                )}
              </p>
            ) : (
              <p className="muted">
                {LOCAL
                  ? 'No key yet. Paste it below once. It is kept only in this browser on this device and is only ever sent to Anthropic. Anyone who can use this browser could use it, so set a monthly spending limit on the key at console.anthropic.com too.'
                  : 'No key yet. Paste it below once. It is kept only on the computer running Studio Bars, never in your browser or in Git.'}
              </p>
            )}
            {status.key.source !== 'env' && (
              <div className="actions">
                <input
                  id="ai-key"
                  className="input"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={
                    status.key.configured ? 'Paste a new key to replace it' : 'Paste key'
                  }
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
                <button className="btn" disabled={busy || key.trim().length < 8} onClick={saveKey}>
                  Save key
                </button>
              </div>
            )}
          </div>

          <label className="ai-field">
            <span>Model</span>
            <select
              className="input"
              value={status.model}
              disabled={busy}
              onChange={(e) => run(() => api.putAiSettings({ model: e.target.value }))}
            >
              {status.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} (about {money(m.typical_request_usd)} a request)
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          {LOCAL ? (
            <p className="muted">
              Works with any server that speaks the OpenAI chat format, like <strong>Ollama</strong>{' '}
              on your computer. On the phone it must have an <strong>https://</strong> address this
              phone can reach (for example through Tailscale), and the server must allow this site.
              “localhost” would mean the phone itself, and phone browsers block plain http://
              addresses from this page.
            </p>
          ) : (
            <p className="muted">
              Works with any server that speaks the OpenAI chat format, like <strong>Ollama</strong>{' '}
              running on this computer (free, nothing leaves your machine).
            </p>
          )}
          <label className="ai-field">
            <span>Server address</span>
            <input
              className="input"
              placeholder={LOCAL ? 'https://my-pc.example.ts.net/v1' : 'http://localhost:11434/v1'}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
          <label className="ai-field">
            <span>Model name</span>
            <input
              className="input"
              placeholder="llama3"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <div className="ai-two">
            <label className="ai-field">
              <span>Price in ($ per million)</span>
              <input
                className="input"
                inputMode="decimal"
                value={priceIn}
                onChange={(e) => setPriceIn(e.target.value)}
              />
            </label>
            <label className="ai-field">
              <span>Price out ($ per million)</span>
              <input
                className="input"
                inputMode="decimal"
                value={priceOut}
                onChange={(e) => setPriceOut(e.target.value)}
              />
            </label>
          </div>
          <div className="ai-field">
            <label htmlFor="ai-key2">Key (only if your server needs one)</label>
            <div className="actions">
              <input
                id="ai-key2"
                className="input"
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button className="btn" disabled={busy || key.trim().length < 8} onClick={saveKey}>
                Save key
              </button>
            </div>
          </div>
        </>
      )}

      <label className="ai-field">
        <span>
          Monthly spending limit (US dollars). Requests that could go over it are blocked.
        </span>
        <input
          className="input"
          inputMode="decimal"
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          onBlur={() => saveSettings()}
        />
      </label>
      <p className="muted ai-meter" aria-live="polite">
        This month: {money(status.usage.spent_usd)} of {money(status.usage.cap_usd)} used ·{' '}
        {status.usage.requests} request{status.usage.requests === 1 ? '' : 's'}. Prices are
        estimates; your AI company’s bill is the real number.
      </p>

      <div className="ai-disclose">
        <p>{status.disclosure}</p>
        {!status.enabled ? (
          <>
            <label className="ai-check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>I understand what is sent and when.</span>
            </label>
            <button
              className="btn btn-primary"
              disabled={busy || !agree}
              onClick={() => saveSettings({ enabled: true })}
            >
              Turn AI on
            </button>
          </>
        ) : (
          <button className="btn" disabled={busy} onClick={() => saveSettings({ enabled: false })}>
            Turn AI off
          </button>
        )}
      </div>

      <div className="actions">
        <button className="btn btn-ghost" disabled={busy || !status.ready} onClick={test}>
          Test connection
        </button>
        {onClose && status.ready && (
          <button className="btn btn-ghost" onClick={onClose}>
            Back to writing
          </button>
        )}
      </div>
      {msg && (
        <p className={msg.ok ? 'ai-ok' : 'ai-err'} role="status">
          {msg.text}
        </p>
      )}
    </div>
  )
}
