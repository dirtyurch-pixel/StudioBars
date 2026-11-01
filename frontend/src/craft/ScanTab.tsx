import { useState } from 'react'
import * as api from '../api'
import type { Chains, ScanResult } from '../types'
import { msg, type CraftProps } from './shared'

export function ScanTab({ songId, sectionLines }: CraftProps) {
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [chains, setChains] = useState<Chains | null>(null)
  const [strict, setStrict] = useState('normal')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    setError('')
    try {
      setScan(await api.scanSong(songId))
    } catch (e) {
      setError(msg(e))
    } finally {
      setBusy(false)
    }
  }
  async function runChains() {
    setError('')
    try {
      setChains(
        await api.getChains(
          sectionLines.map((l) => l.text),
          strict,
        ),
      )
    } catch (e) {
      setError(msg(e))
    }
  }

  return (
    <div className="ai-panel">
      <p className="muted ai-note">
        These tools point things out. They are estimates and never change your lyrics. Make sure
        your latest edits have saved first.
      </p>
      <button className="btn btn-primary" disabled={busy} onClick={() => void run()}>
        {busy ? 'Scanning…' : 'Scan the whole song'}
      </button>
      {error && (
        <p className="ai-err" role="alert">
          {error}
        </p>
      )}
      {scan && (
        <div className="ai-results" aria-label="Scan results">
          <h4 className="ai-h">Structure</h4>
          <table className="keys">
            <thead>
              <tr>
                <th>Section</th>
                <th>Lines</th>
                <th>Avg syl.</th>
                <th>Rhyme families</th>
              </tr>
            </thead>
            <tbody>
              {scan.structure.sections.map((s, i) => (
                <tr key={i}>
                  <td>{s.label}</td>
                  <td>{s.lines}</td>
                  <td>{s.avg_syllables ?? '–'}</td>
                  <td>{s.rhyme_families}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {scan.structure.notes.map((n, i) => (
            <p key={i} className="warn">
              {n}
            </p>
          ))}
          <p className="muted ai-note">{scan.structure.disclaimer}</p>

          <h4 className="ai-h">Possible clichés ({scan.cliches.length})</h4>
          {scan.cliches.length === 0 && (
            <p className="muted">
              None found in the list I check. That does not mean there are none.
            </p>
          )}
          {scan.cliches.map((c, i) => (
            <p key={i}>
              <strong>“{c.phrase}”</strong> in {c.section}: <span className="muted">{c.text}</span>
            </p>
          ))}

          <h4 className="ai-h">Repeated lines ({scan.repeated_lines.length})</h4>
          {scan.repeated_lines.map((r, i) => (
            <p key={i}>
              “{r.text}” ×{r.count}{' '}
              <span className="ai-tag">{r.intentional ? 'looks intentional' : 'check this'}</span>
            </p>
          ))}
          {scan.reused_phrases.map((r, i) => (
            <p key={i}>
              Phrase “{r.phrase}” appears in {r.count} lines.
            </p>
          ))}

          <h4 className="ai-h">Filler words ({scan.filler.length})</h4>
          {scan.filler.map((f, i) => (
            <p key={i}>
              {f.section}: <span className="muted">{f.text}</span> ({f.words.join(', ')})
            </p>
          ))}
        </div>
      )}

      <h4 className="ai-h">Rhyme chains in this section</h4>
      <div className="actions">
        <select
          className="input input-sm"
          aria-label="Strictness"
          value={strict}
          onChange={(e) => setStrict(e.target.value)}
        >
          <option value="strict">Strict (perfect rhymes)</option>
          <option value="normal">Normal (+ near rhymes)</option>
          <option value="loose">Loose (+ same vowel)</option>
        </select>
        <button className="btn" onClick={() => void runChains()}>
          Find chains
        </button>
      </div>
      {chains && chains.chains.length === 0 && (
        <p className="muted">No chains at this strictness.</p>
      )}
      {chains?.chains.map((c, i) => (
        <p key={i}>
          {c.members
            .map((m) => `${m.word}${m.alternate_pronunciations ? '*' : ''} (line ${m.line + 1})`)
            .join(' · ')}{' '}
          <span className="ai-tag">{c.internal ? 'internal' : 'across lines'}</span>
          {c.weakest_link && <span className="muted"> weakest link: {c.weakest_link}</span>}
        </p>
      ))}
      {chains && <p className="muted ai-note">* has another pronunciation. {chains.note}</p>}
    </div>
  )
}
