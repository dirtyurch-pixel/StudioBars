import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { SLOTS_PER_BAR, type FlowGrid, type Subdivision, type SyllableInfo } from '../types'
import {
  clickTimes,
  density,
  evenGrid,
  fitGrid,
  place,
  resubdivide,
  slotCount,
  toggleRest,
} from './flow'
import { msg, useLoad, type CraftProps } from './shared'

const STRESS = { 1: 'ˈ', 2: 'ˌ', 0: '' } as const

function useMetronome(bpm: number, bars: number) {
  const [on, setOn] = useState(false)
  const ctx = useRef<AudioContext | null>(null)
  const stop = () => {
    void ctx.current?.close().catch(() => undefined)
    ctx.current = null
    setOn(false)
  }
  useEffect(() => () => void ctx.current?.close().catch(() => undefined), [])
  const start = () => {
    const AC = window.AudioContext
    if (!AC) return
    const c = new AC()
    ctx.current = c
    const t0 = c.currentTime + 0.1
    for (const { t, accent } of clickTimes(bpm, bars, 16)) {
      const o = c.createOscillator()
      const g = c.createGain()
      o.frequency.value = accent ? 1400 : 900
      g.gain.setValueAtTime(0.0001, t0 + t)
      g.gain.exponentialRampToValueAtTime(0.4, t0 + t + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + t + 0.06)
      o.connect(g).connect(c.destination)
      o.start(t0 + t)
      o.stop(t0 + t + 0.08)
    }
    setOn(true)
    window.setTimeout(() => ctx.current === c && stop(), (16 * bars * 4 * 60000) / bpm + 400)
  }
  return { on, start, stop }
}

export function FlowTab({ songId, activeLine, bpm }: CraftProps) {
  const grids = useLoad(() => api.getGrids(songId), [songId])
  const [syl, setSyl] = useState<SyllableInfo[] | null>(null)
  const [grid, setGrid] = useState<FlowGrid | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [status, setStatus] = useState('')
  const lineId = activeLine?.id
  const text = activeLine?.text ?? ''
  const tempo = bpm && bpm >= 40 && bpm <= 240 ? bpm : 90
  const metro = useMetronome(tempo, grid?.bars ?? 1)

  useEffect(() => {
    if (!text.trim()) {
      setSyl(null)
      return
    }
    const ctl = new AbortController()
    const t = setTimeout(() => {
      api
        .getSyllables(text, ctl.signal)
        .then((r) => setSyl(r.syllables))
        .catch(() => undefined)
    }, 250)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [text])

  useEffect(() => {
    if (!syl || !lineId || !grids.data) return
    const saved = grids.data[lineId]
    setGrid(saved ? fitGrid(saved, syl.length) : evenGrid(syl.length))
    setSel(null)
  }, [syl, lineId, grids.data])

  // the "saved" message must survive the reload that follows saving, but not a change of line
  useEffect(() => setStatus(''), [lineId])

  if (!activeLine || !text.trim())
    return <p className="muted">Click a line that has words to plan its rhythm.</p>
  if (!syl || !grid) return <p className="muted">Working out the syllables…</p>

  const per = SLOTS_PER_BAR[grid.subdivision]
  const d = density(grid, syl)
  const set = (g: FlowGrid) => {
    setGrid(g)
    setStatus('')
  }
  const unplaced = grid.assign.map((a, i) => (a === null ? i : -1)).filter((i) => i >= 0)

  function clickSlot(slot: number) {
    if (!grid) return
    const here = grid.assign.indexOf(slot)
    if (sel !== null) {
      set(place(grid, sel, slot))
      setSel(null)
    } else if (here >= 0) setSel(here)
    else set(toggleRest(grid, slot))
  }

  async function save() {
    if (!grid || !lineId) return
    try {
      await api.putGrid(songId, lineId, grid)
      await grids.reload()
      setStatus('Flow saved. Your lyric text was not touched.')
    } catch (e) {
      setStatus(msg(e))
    }
  }

  return (
    <div className="ai-panel">
      <p className="muted ai-note">
        Line {activeLine.number}: place each syllable on the beat grid yourself. This is a plan, not
        a measurement. Your lyric text never changes here.
      </p>
      <div className="flow-syls" role="group" aria-label="Syllables">
        {syl.map((s, i) => (
          <button
            key={i}
            className={`chip-word${sel === i ? ' on' : ''}${grid.assign[i] === null ? ' flow-unplaced' : ''}`}
            aria-pressed={sel === i}
            aria-label={`Syllable ${i + 1} ${s.word}${s.stress === 1 ? ' stressed' : ''}${grid.assign[i] === null ? ' not placed' : ''}`}
            onClick={() => setSel(sel === i ? null : i)}
          >
            {s.stress !== null && s.stress !== undefined ? STRESS[s.stress] : '~'}
            {s.word.toLowerCase()}
            {grid.accents[i] && <sup>●</sup>}
          </button>
        ))}
      </div>
      <p className="muted ai-note">
        {sel === null
          ? 'Tap a syllable, then tap a slot. Tap an empty slot with nothing selected to mark a rest.'
          : `Syllable ${sel + 1} selected: tap a slot to place it.`}
      </p>
      {sel !== null && (
        <div className="actions">
          <button
            className="btn btn-ghost"
            onClick={() =>
              set({ ...grid, accents: grid.accents.map((a, i) => (i === sel ? !a : a)) })
            }
          >
            {grid.accents[sel] ? 'Remove accent' : 'Accent it'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              set(place(grid, sel, null))
              setSel(null)
            }}
          >
            Take it off the grid
          </button>
        </div>
      )}

      {Array.from({ length: grid.bars }, (_, bar) => (
        <div key={bar} className="flow-bar" role="group" aria-label={`Bar ${bar + 1}`}>
          {Array.from({ length: per }, (_, k) => {
            const slot = bar * per + k
            const who = grid.assign.indexOf(slot)
            const beatStart = k % (per / 4) === 0
            return (
              <button
                key={slot}
                className={`flow-cell${beatStart ? ' beat' : ''}${who >= 0 ? ' used' : ''}${who >= 0 && who === sel ? ' sel' : ''}${grid.rests.includes(slot) ? ' rest' : ''}`}
                aria-label={`Bar ${bar + 1} slot ${k + 1}${who >= 0 ? ` syllable ${who + 1}` : grid.rests.includes(slot) ? ' rest' : ' empty'}`}
                onClick={() => clickSlot(slot)}
              >
                {who >= 0 ? who + 1 : grid.rests.includes(slot) ? '–' : ''}
              </button>
            )
          })}
        </div>
      ))}

      <div className="ai-two">
        <label className="ai-field">
          <span>Subdivision</span>
          <select
            className="input"
            value={grid.subdivision}
            onChange={(e) => set(resubdivide(grid, e.target.value as Subdivision))}
          >
            <option value="8th">8th notes (8 per bar)</option>
            <option value="16th">16th notes (16 per bar)</option>
            <option value="triplet">Triplets (12 per bar)</option>
          </select>
        </label>
        <label className="ai-field">
          <span>Bars</span>
          <select
            className="input"
            value={grid.bars}
            onChange={(e) => set(resubdivide(grid, grid.subdivision, Number(e.target.value)))}
          >
            <option value={1}>1 bar</option>
            <option value={2}>2 bars</option>
          </select>
        </label>
      </div>

      <p className="muted" role="status">
        {d.placed} of {d.total} syllables placed · per bar: {d.perBar.join(', ')} ·{' '}
        {slotCount(grid)} slots
        {d.stressedOffBeat > 0 &&
          ` · ${d.stressedOffBeat} stressed ${d.stressedOffBeat === 1 ? 'syllable sits' : 'syllables sit'} off the main beats (that can be a good choice)`}
        {unplaced.length > 0 && ` · not placed: ${unplaced.map((i) => i + 1).join(', ')}`}
      </p>
      <p className="muted ai-note">
        Stress marks come from the dictionary (ˈ main, ˌ secondary, ~ unknown word). All of this is
        an estimate.
      </p>

      <div className="actions">
        <button className="btn btn-primary" onClick={() => void save()}>
          Save flow
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => set(evenGrid(syl.length, grid.subdivision, grid.bars))}
        >
          Spread evenly
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => (metro.on ? metro.stop() : metro.start())}
          aria-pressed={metro.on}
        >
          {metro.on ? 'Stop click' : `Click at ${tempo} BPM`}
        </button>
      </div>
      {!bpm && <p className="muted ai-note">No BPM is set for this song, so the click uses 90.</p>}
      {status && (
        <p className="ai-ok" role="status">
          {status}
        </p>
      )}
    </div>
  )
}
