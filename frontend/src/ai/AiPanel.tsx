import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { ApiFail } from '../api'
import { useToast } from '../components/toastContext'
import type { AiCandidate, AiPrepared, AiRequest, AiResult, AiStatus, AiTaskInfo } from '../types'
import { AiSetup } from './AiSetup'
import { syllableText } from './format'

type Props = {
  songId: string
  sectionId: string | null
  sectionLabel: string
  activeLine: { id: string; text: string; locked: boolean; number: number } | null
  lastLineId: string | null
  /** Make sure everything typed is saved before the server reads the song. */
  saveNow: () => Promise<boolean>
  /** These go through the editor's normal guarded edit path (locked lines can never change). */
  onInsert: (text: string, afterLineId: string | null) => boolean
  onReplace: (lineId: string, text: string) => boolean
  lineText: (lineId: string) => string | null
}

const money = (n: number) => `$${n.toFixed(n < 0.01 && n > 0 ? 4 : 3)}`

const QUALITY: Record<string, string> = {
  homophone: 'sounds the same',
  rich: 'rich rhyme',
  perfect: 'perfect rhyme',
  near: 'near rhyme',
  assonance: 'vowel rhyme',
  consonance: 'consonant rhyme',
}

export function AiPanel(p: Props) {
  const toast = useToast()
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [error, setError] = useState('')
  const [setup, setSetup] = useState(false)
  const [task, setTask] = useState<AiTaskInfo | null>(null)
  const [count, setCount] = useState(3)
  const [instruction, setInstruction] = useState('')
  const [syl, setSyl] = useState('')
  const [others, setOthers] = useState(false)
  const [persona, setPersona] = useState('co_writer')
  const [prepared, setPrepared] = useState<{ req: AiRequest; data: AiPrepared } | null>(null)
  const [busy, setBusy] = useState<'prepare' | 'send' | null>(null)
  // when the AI answers (or something fails), bring it into view: on a phone it is below the form
  const answerRef = useRef<HTMLDivElement>(null)
  const failRef = useRef<HTMLParagraphElement>(null)
  const [result, setResult] = useState<AiResult | null>(null)
  const [fail, setFail] = useState('')
  useEffect(() => {
    if (!result) return
    const el = answerRef.current
    if (!el) return
    el.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    el.focus({ preventScroll: true }) // screen readers move to the answer too
  }, [result])
  useEffect(() => {
    if (fail) failRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [fail])
  const abort = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getAiStatus())
      setError('')
    } catch (e) {
      setError(e instanceof ApiFail ? e.message : 'Could not load AI settings.')
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => () => abort.current?.abort(), [])

  if (error)
    return (
      <div className="panel-empty">
        <p className="ai-err">{error}</p>
        <button className="btn" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    )
  if (!status) return <p className="muted">Loading…</p>
  if (!status.ready || setup)
    return (
      <AiSetup
        status={status}
        onStatus={setStatus}
        onClose={status.ready ? () => setSetup(false) : undefined}
      />
    )

  const current = task ?? status.tasks[0]
  const needLine =
    current.needs_line && (!p.activeLine || p.activeLine.locked || !p.activeLine.text.trim())
  const rhymeId = current.needs_rhyme
    ? p.activeLine?.text.trim()
      ? p.activeLine.id
      : p.lastLineId
    : null

  function buildReq(): AiRequest | null {
    if (!p.sectionId) return null
    const n = Number(syl)
    return {
      song_id: p.songId,
      section_id: p.sectionId,
      task: current.id,
      target_line_id: current.needs_line ? (p.activeLine?.id ?? null) : null,
      rhyme_with_line_id: rhymeId,
      count,
      instruction: instruction.trim(),
      target_syllables: Number.isInteger(n) && n > 0 ? n : null,
      include_other_sections: others,
      persona,
    }
  }

  async function preview() {
    const req = buildReq()
    if (!req) return
    setFail('')
    setResult(null)
    setBusy('prepare')
    try {
      if (!(await p.saveNow())) {
        setFail('Could not save your song first, so nothing was prepared. Try again in a moment.')
        return
      }
      setPrepared({ req, data: await api.aiPrepare(req) })
    } catch (e) {
      setPrepared(null)
      setFail(e instanceof ApiFail ? e.message : 'Something went wrong. Nothing was sent.')
    } finally {
      setBusy(null)
    }
  }

  async function send() {
    if (!prepared) return
    const ctl = new AbortController()
    abort.current = ctl
    setBusy('send')
    setFail('')
    try {
      const res = await api.aiSuggest(prepared.req, prepared.data.hash, ctl.signal)
      setResult(res)
      setPrepared(null)
      void refresh()
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setFail('Cancelled. Nothing was changed.')
      } else {
        setFail(e instanceof ApiFail ? e.message : 'Something went wrong. Nothing was changed.')
        if (e instanceof ApiFail && e.code === 'CONTEXT_CHANGED') setPrepared(null)
        void refresh()
      }
    } finally {
      abort.current = null
      setBusy(null)
    }
  }

  const usage = status.usage
  return (
    <div className="ai-panel">
      <div className="ai-top">
        <span className="muted ai-meter">
          {status.model} · {money(usage.spent_usd)} of {money(usage.cap_usd)} this month
        </span>
        <button
          className="btn btn-ghost"
          onClick={() => {
            setPrepared(null) // settings may change the cost or the limit, so look again afterwards
            setSetup(true)
          }}
        >
          Settings
        </button>
      </div>
      <p className="muted ai-note">
        The AI only suggests. Nothing changes in your song until you press Insert or Replace.
      </p>

      {status.tasks.some((t) => t.id === 'improve') && current.id !== 'improve' && (
        <button
          className="btn btn-primary ai-improve"
          onClick={() => {
            setTask(status.tasks.find((t) => t.id === 'improve')!)
            setPrepared(null)
            setResult(null)
            setFail('')
          }}
        >
          ✨ Improve my lines
        </button>
      )}
      {current.id === 'improve' && (
        <p className="muted">
          The AI reads this section, picks the lines that could be stronger and suggests a better
          version of each. Locked lines are never touched, and nothing changes until you press
          Replace.
        </p>
      )}
      <div className="chips" role="group" aria-label="What should the AI do?">
        {status.tasks.map((t) => (
          <button
            key={t.id}
            className={`chip-word${current.id === t.id ? ' on' : ''}`}
            aria-pressed={current.id === t.id}
            onClick={() => {
              setTask(t)
              setPrepared(null)
              setResult(null)
              setFail('')
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {current.needs_line && (
        <p className={needLine ? 'warn' : 'muted'}>
          {p.activeLine && !p.activeLine.locked && p.activeLine.text.trim()
            ? `Working on line ${p.activeLine.number}: “${p.activeLine.text}”`
            : p.activeLine?.locked
              ? 'That line is locked. Click an unlocked line.'
              : 'Click the line you want changed.'}
        </p>
      )}
      {current.needs_rhyme && (
        <p className="muted">
          {rhymeId && p.lineText(rhymeId)
            ? `Rhyming with: “${p.lineText(rhymeId)}”`
            : 'Write a line first to rhyme with.'}
        </p>
      )}

      {current.kind === 'lines' && (
        <div className="ai-two">
          <label className="ai-field">
            <span>How many options</span>
            <select
              className="input"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="ai-field">
            <span>Aim for syllables (optional)</span>
            <input
              className="input"
              inputMode="numeric"
              value={syl}
              onChange={(e) => setSyl(e.target.value.replace(/\D/g, '').slice(0, 2))}
            />
          </label>
        </div>
      )}
      <label className="ai-field">
        <span>Writing style of the helper</span>
        <select
          className="input"
          aria-label="Helper style"
          value={persona}
          onChange={(e) => {
            setPersona(e.target.value)
            setPrepared(null)
          }}
        >
          {status.personas.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
        <span className="muted">{status.personas.find((x) => x.id === persona)?.text}</span>
      </label>
      <label className="ai-field">
        <span>Anything else? (optional, short)</span>
        <input
          className="input"
          maxLength={200}
          placeholder="e.g. darker, sung softly, about leaving home"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
      </label>
      {!current.whole_song && (
        <label className="ai-check">
          <input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} />
          <span>Also send my other sections (more context, more cost)</span>
        </label>
      )}

      <button
        className="btn btn-primary"
        disabled={busy !== null || needLine || !p.sectionId}
        onClick={() => void preview()}
      >
        {busy === 'prepare' ? 'Preparing…' : 'Show what will be sent'}
      </button>

      {fail && (
        <p className="ai-err" role="alert" ref={failRef}>
          {fail}
        </p>
      )}

      {prepared && (
        <div className="ai-send" role="region" aria-label="What will be sent">
          <h4 className="ai-h">What will be sent</h4>
          <p>
            Your title, genres and the lines of{' '}
            <strong>{prepared.data.sent.sections.join(', ')}</strong> ({prepared.data.sent.lines}{' '}
            lines) go to <strong>{prepared.data.model}</strong>. Your notes and your key are not
            sent.
          </p>
          <p className="muted">
            Estimated cost about {money(prepared.data.est_cost_usd)} (most it could be:{' '}
            {money(prepared.data.worst_cost_usd)}).
          </p>
          <details>
            <summary>See the exact text</summary>
            <pre className="ai-pre">{prepared.data.user}</pre>
          </details>
          {prepared.data.over_budget && (
            <p className="ai-err">
              This could go over your monthly limit, so it is blocked. Raise the limit in Settings.
            </p>
          )}
          <div className="actions">
            {busy === 'send' ? (
              <button className="btn" onClick={() => abort.current?.abort()}>
                Cancel
              </button>
            ) : (
              <>
                <button
                  className="btn btn-primary"
                  disabled={prepared.data.over_budget}
                  onClick={() => void send()}
                >
                  Send to AI
                </button>
                <button className="btn btn-ghost" onClick={() => setPrepared(null)}>
                  Don’t send
                </button>
              </>
            )}
          </div>
          {busy === 'send' && <p className="muted">Waiting for the AI…</p>}
        </div>
      )}

      {result && result.kind === 'notes' && (
        <div className="ai-results" aria-label="AI notes" ref={answerRef} tabIndex={-1}>
          <h4 className="ai-h">AI notes (advice only)</h4>
          <ul>
            {result.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <p className="muted">
            Cost this time {money(result.usage.cost_usd)}. These are only ideas, nothing was
            changed.
          </p>
        </div>
      )}

      {result && result.kind === 'lines' && (
        <div className="ai-results" aria-label="AI suggestions" ref={answerRef} tabIndex={-1}>
          <h4 className="ai-h">AI suggestions</h4>
          {result.suggestions.map((c) => (
            <Candidate
              key={c.id}
              c={c}
              targetId={c.target_line_id ?? result.target_line_id ?? null}
              afterId={c.target_line_id ?? p.activeLine?.id ?? p.lastLineId}
              lineText={p.lineText}
              onInsert={p.onInsert}
              onReplace={p.onReplace}
              onUsed={(id) => {
                void api.aiAccept(id).catch(() => undefined)
              }}
              toast={toast}
            />
          ))}
          <p className="muted">
            Cost this time {money(result.usage.cost_usd)}. Syllables are estimates. The AI cannot
            check that a line is truly original, so read it with that in mind.
          </p>
        </div>
      )}
    </div>
  )
}

function Candidate(props: {
  c: AiCandidate
  targetId: string | null
  afterId: string | null
  lineText: (id: string) => string | null
  onInsert: (text: string, after: string | null) => boolean
  onReplace: (id: string, text: string) => boolean
  onUsed: (suggestionId: string) => void
  toast: (m: string, kind?: 'success' | 'error' | 'info') => void
}) {
  const { c, toast } = props
  const [show, setShow] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const old = props.targetId ? props.lineText(props.targetId) : null

  return (
    <div className="ai-card">
      {c.target_line_id && old !== null && (
        <p className="ai-was">
          <span className="muted">Instead of: </span>“{old}”
        </p>
      )}
      <p className="ai-text">{c.text}</p>
      <p className="ai-meta">
        <span className="ai-tag">AI suggestion</span>
        <span>{syllableText(c.syllables)}</span>
        {c.rhymes_with_target && (
          <span className="ai-rhyme">{QUALITY[c.rhymes_with_target] ?? 'rhymes'}</span>
        )}
      </p>
      {c.reason && <p className="muted ai-reason">{c.reason}</p>}
      {show && (
        <div className="ai-compare">
          {old !== null && (
            <p>
              <span className="muted">Now: </span>
              {old}
            </p>
          )}
          <p>
            <span className="muted">AI: </span>
            {c.text}
          </p>
        </div>
      )}
      <div className="actions">
        <button className="btn btn-ghost" aria-pressed={show} onClick={() => setShow((v) => !v)}>
          Preview
        </button>
        <button
          className="btn"
          onClick={() => {
            if (props.onInsert(c.text, props.afterId)) {
              props.onUsed(c.id)
              toast('Added as a new line. You can undo it.', 'success')
            }
          }}
        >
          Insert below
        </button>
        {props.targetId && old !== null && !confirm && (
          <button className="btn" onClick={() => setConfirm(true)}>
            Replace line…
          </button>
        )}
        {confirm && props.targetId && (
          <>
            <button
              className="btn btn-danger"
              onClick={() => {
                setConfirm(false)
                if (props.onReplace(props.targetId!, c.text)) {
                  props.onUsed(c.id)
                  toast('Line replaced. You can undo it.', 'success')
                }
              }}
            >
              Yes, replace it
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirm(false)}>
              Keep mine
            </button>
          </>
        )}
        <button
          className="btn btn-ghost"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(c.text)
              .then(() => toast('Copied.', 'success'))
              .catch(() => toast('Could not copy.', 'error'))
          }}
        >
          Copy
        </button>
      </div>
    </div>
  )
}
