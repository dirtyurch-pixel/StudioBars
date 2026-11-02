import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api'
import { ApiFail, LOCAL } from '../api'
import { GenrePicker } from '../components/GenrePicker'
import { Modal } from '../components/Modal'
import { Pad, type FocusRequest } from '../components/Pad'
import { FilesPanel, HistoryPanel, NotesPanel } from '../components/SidePanels'
import { SHORTCUTS } from '../editor/shortcuts'
import { useToast } from '../components/toastContext'
import {
  addLineAfter,
  insertLineWithText,
  addSection,
  deleteSection,
  findLine,
  lockViolations,
  mergeServerMeta,
  mergeUp,
  moveSection,
  pasteLines,
  removeLine,
  renameSection,
  sectionHasLocked,
  setLineText,
  setSectionType,
  splitLine,
  newId,
  type Edit,
} from '../editor/content'
import { useHistory } from '../editor/useHistory'
import { SessionStrip, SongMusicPanel } from '../music/SongMusicPanel'
import { lastWord } from '../phonetics/highlight'
import { usePadSettings } from '../phonetics/padSettings'
import { RhymePanel } from '../phonetics/RhymePanel'
import { WordsPanel } from '../words/WordsPanel'
import { AiPanel } from '../ai/AiPanel'
import { CraftPanel } from '../craft/CraftPanel'
import { useLineAnalysis } from '../phonetics/useLineAnalysis'
import { useSongLink } from '../music/useSongLink'
import { goHome, goSong } from '../route'
import {
  SECTION_TYPES,
  type Content,
  type Line,
  type Genre,
  type Revision,
  type SectionType,
} from '../types'

const NO_LINES: Line[] = []

type Phase = 'loading' | 'ready' | 'error' | 'missing'
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'offline' | 'error' | 'conflict'
type Meta = { title: string; genres: Genre[]; bpm: number | null; time_signature: string | null }
type Tool = 'notes' | 'rhymes' | 'words' | 'ai' | 'craft' | 'music' | 'history' | 'files'

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes…',
  saving: 'Saving…',
  offline: 'Offline. Changes kept here and will save when the server is back.',
  error: 'Could not save. Retrying…',
  conflict: 'Changed in another window.',
}

export default function SongEditor({ id }: { id: string }) {
  const toast = useToast()
  const songLink = useSongLink(id)
  const [phase, setPhase] = useState<Phase>('loading')
  const [loadError, setLoadError] = useState('')
  const [meta, setMeta] = useState<Meta | null>(null)
  const [copying, setCopying] = useState(false)
  const [copyId, setCopyId] = useState<string | null>(null)
  const hist = useHistory([])
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [activeLineId, setActiveLineId] = useState<string | null>(null)
  const [focusReq, setFocusReq] = useState<FocusRequest>(null)
  const [tool, setTool] = useState<Tool>('notes')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [revisions, setRevisions] = useState<Revision[] | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [addingSection, setAddingSection] = useState<string | null>(null)
  const [confirmDelSection, setConfirmDelSection] = useState(false)
  const [optsOpen, setOptsOpen] = useState(
    () => window.matchMedia?.('(min-width: 861px)').matches ?? true,
  )

  const contentRef = useRef<Content>(hist.content)
  contentRef.current = hist.content
  const versionRef = useRef(0)
  const dirty = useRef(false)
  const metaPatch = useRef<Partial<Meta> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflight = useRef<Promise<boolean> | null>(null)
  const attempts = useRef(0)
  const lastBlocked = useRef(0)
  const statusRef = useRef<SaveStatus>('saved')
  const setSaveStatus = useCallback((s: SaveStatus) => {
    statusRef.current = s
    setStatus(s)
  }, [])
  const flushRef = useRef<() => Promise<boolean>>(async () => true)

  const content = hist.content
  const section = content.find((s) => s.id === activeSectionId) ?? content[0] ?? null

  // Phase 2: syllables, rhyme colours and the rhyme lookup
  const pad = usePadSettings()
  const [analysisNonce, setAnalysisNonce] = useState(0)
  const [lookup, setLookup] = useState<{ word: string; nonce: number } | null>(null)
  const [phraseReq, setPhraseReq] = useState<{ phrase: string; nonce: number } | null>(null)
  const clearPhraseReq = useCallback(() => setPhraseReq(null), [])
  const analysis = useLineAnalysis(section?.lines ?? NO_LINES, analysisNonce)
  const syllableDisplay = pad.syllableDisplay
  const highlight = pad.highlight
  // the line being written, and (separately) the lines beside it
  const { lineContext, aroundContext } = useMemo(() => {
    const ls = section?.lines ?? NO_LINES
    const i = ls.findIndex((l) => l.id === activeLineId)
    if (i < 0) return { lineContext: '', aroundContext: '' }
    return {
      lineContext: ls[i].text.slice(0, 600),
      aroundContext: [ls[i - 1]?.text, ls[i + 1]?.text].filter(Boolean).join(' ').slice(0, 600),
    }
  }, [section, activeLineId])

  // ---------------------------------------------------------- loading
  const load = useCallback(async () => {
    setPhase('loading')
    try {
      const song = await api.getSong(id)
      setMeta({
        title: song.title,
        genres: song.genres,
        bpm: song.bpm,
        time_signature: song.time_signature,
      })
      hist.reset(song.sections)
      versionRef.current = song.version
      dirty.current = false
      metaPatch.current = null
      attempts.current = 0
      setActiveSectionId(song.sections[0]?.id ?? null)
      setActiveLineId(null)
      setSaveStatus('saved')
      setPhase('ready')
    } catch (e) {
      if (e instanceof ApiFail && e.status === 404) setPhase('missing')
      else {
        setLoadError(
          e instanceof ApiFail && e.network
            ? 'Cannot reach the Studio Bars server. Check it is running, then try again.'
            : e instanceof ApiFail
              ? e.message
              : 'Something went wrong.',
        )
        setPhase('error')
      }
    }
    // hist.reset and setSaveStatus are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (meta) document.title = `${meta.title} · Studio Bars`
    return () => {
      document.title = 'Studio Bars'
    }
  }, [meta?.title]) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshRevisions = useCallback(async () => {
    try {
      setRevisions(await api.listRevisions(id))
    } catch {
      /* the History tab shows what it has */
    }
  }, [id])

  // ---------------------------------------------------------- saving
  const schedule = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flushRef.current(), ms)
  }, [])

  const flush = useCallback(async (): Promise<boolean> => {
    if (inflight.current) await inflight.current
    if (!dirty.current && !metaPatch.current) return true
    const run = (async () => {
      setSaveStatus('saving')
      try {
        if (metaPatch.current) {
          const patch = metaPatch.current
          metaPatch.current = null
          try {
            await api.patchSong(id, patch)
          } catch (e) {
            const later = metaPatch.current as Partial<Meta> | null
            metaPatch.current = { ...patch, ...later }
            throw e
          }
        }
        if (dirty.current) {
          dirty.current = false
          const sent = contentRef.current
          try {
            const saved = await api.saveContent(id, versionRef.current, sent)
            versionRef.current = saved.version
            hist.patch((c) => mergeServerMeta(c, saved.sections))
          } catch (e) {
            dirty.current = true
            throw e
          }
        }
        attempts.current = 0
        if (dirty.current || metaPatch.current) schedule(200)
        else setSaveStatus('saved')
        return true
      } catch (e) {
        const fail = e instanceof ApiFail ? e : new ApiFail('Unexpected error.')
        if (fail.code === 'LOCKED_LINES') {
          toast(
            'A locked line was protected. Your page has been reloaded from the saved copy.',
            'error',
          )
          await load()
          void refreshRevisions()
          return false
        }
        if (fail.code === 'VERSION_CONFLICT') {
          setCopyId(null)
          setSaveStatus('conflict')
          return false
        }
        setSaveStatus(fail.network ? 'offline' : 'error')
        attempts.current += 1
        schedule(Math.min(30000, 2000 * 2 ** Math.min(attempts.current, 4)))
        return false
      }
    })()
    inflight.current = run
    try {
      return await run
    } finally {
      inflight.current = null
    }
  }, [id, hist, load, refreshRevisions, schedule, setSaveStatus, toast])
  flushRef.current = flush

  /** Save everything pending; true if the server now has the latest text. */
  const saveNow = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    for (let i = 0; i < 4; i++) {
      if (!dirty.current && !metaPatch.current && !inflight.current) return true
      if (!(await flushRef.current())) return false
    }
    return !dirty.current
  }, [])

  const markDirty = useCallback(() => {
    dirty.current = true
    if (statusRef.current !== 'offline' && statusRef.current !== 'conflict')
      setSaveStatus('unsaved')
    schedule(700)
  }, [schedule, setSaveStatus])

  useEffect(() => {
    const onOnline = () => void flushRef.current()
    const onOffline = () => {
      if (dirty.current && !LOCAL) setSaveStatus('offline') // the phone version saves on the device
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushRef.current()
    }
    // "Reload to update" asks every open song to save first and waits for the answer
    const onSaveNow = (e: Event) => {
      ;(e as CustomEvent<{ waits: Promise<boolean>[] }>).detail.waits.push(saveNow())
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current || metaPatch.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('sb-save-now', onSaveNow)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('sb-save-now', onSaveNow)
      if (timer.current) clearTimeout(timer.current)
      if (dirty.current || metaPatch.current) void flushRef.current() // best effort on leaving
    }
  }, [setSaveStatus, saveNow])

  // ---------------------------------------------------------- editing
  const blocked = useCallback(() => {
    const t = Date.now()
    if (t - lastBlocked.current < 2500) return
    lastBlocked.current = t
    toast('That line is locked. Unlock it first if you want to change it.', 'error')
  }, [toast])

  const apply = useCallback(
    (next: Content | null, key?: string): boolean => {
      if (!next || lockViolations(contentRef.current, next).length) {
        blocked()
        return false
      }
      hist.commit(next, key)
      markDirty()
      return true
    },
    [blocked, hist, markDirty],
  )

  const applyEdit = useCallback(
    (e: Edit | null) => {
      if (!e) return false
      if (!apply(e.content)) return false
      setFocusReq({ id: e.focusId, caret: e.caret, n: Date.now() + Math.random() })
      return true
    },
    [apply],
  )

  const onText = (lineId: string, text: string) => {
    const next = setLineText(contentRef.current, lineId, text)
    if (next === null) blocked()
    else if (next !== contentRef.current) apply(next, `text:${lineId}`)
  }

  const toggleLock = useCallback(
    async (lineId: string) => {
      const f = findLine(contentRef.current, lineId)
      if (!f) return
      if (!(await saveNow())) {
        toast('Could not save first, so the lock was not changed.', 'error')
        return
      }
      try {
        const song = await api.lockLine(lineId, !f.line.is_locked)
        hist.patch((c) => mergeServerMeta(c, song.sections))
        toast(f.line.is_locked ? 'Line unlocked.' : 'Line locked.', 'success')
      } catch (e) {
        toast(e instanceof ApiFail ? e.message : 'Could not change the lock.', 'error')
      }
    },
    [hist, saveNow, toast],
  )

  const undo = useCallback(() => {
    const r = hist.undo()
    if (r === 'ok') markDirty()
    else if (r !== 'empty') toast('Undo skipped: it would change a locked line.', 'error')
  }, [hist, markDirty, toast])
  const redo = useCallback(() => {
    const r = hist.redo()
    if (r === 'ok') markDirty()
    else if (r !== 'empty') toast('Redo skipped: it would change a locked line.', 'error')
  }, [hist, markDirty, toast])

  // meta fields
  const changeMeta = (patch: Partial<Meta>) => {
    setMeta((m) => (m ? { ...m, ...patch } : m))
    metaPatch.current = { ...metaPatch.current, ...patch }
    if (statusRef.current !== 'offline') setSaveStatus('unsaved')
    schedule(800)
  }

  // sections
  const sectionOps = {
    add: (label: string) => {
      const r = addSection(contentRef.current, label)
      if (apply(r.content)) setActiveSectionId(r.id)
    },
    rename: (sid: string, label: string) => apply(renameSection(contentRef.current, sid, label)),
    type: (sid: string, t: SectionType) => apply(setSectionType(contentRef.current, sid, t)),
    move: (sid: string, d: -1 | 1) => apply(moveSection(contentRef.current, sid, d)),
    remove: (sid: string) => {
      const next = deleteSection(contentRef.current, sid)
      if (!next) {
        toast(
          sectionHasLocked(contentRef.current, sid)
            ? 'This section has a locked line. Unlock it before deleting the section.'
            : 'A song needs at least one section.',
          'error',
        )
        return
      }
      if (apply(next)) setActiveSectionId(next[0].id)
    },
  }

  // history
  const onSnapshot = async (description: string) => {
    if (!(await saveNow())) return toast('Could not save first. Try again in a moment.', 'error')
    try {
      setRevisions(await api.createRevision(id, description))
      toast('Snapshot saved.', 'success')
    } catch (e) {
      toast(e instanceof ApiFail ? e.message : 'Could not save the snapshot.', 'error')
    }
  }
  const onRestore = async (revId: string) => {
    if (!(await saveNow())) return toast('Could not save first. Try again in a moment.', 'error')
    try {
      const song = await api.restoreRevision(revId)
      setMeta({
        title: song.title,
        genres: song.genres,
        bpm: song.bpm,
        time_signature: song.time_signature,
      })
      hist.reset(song.sections)
      versionRef.current = song.version
      if (!song.sections.some((s) => s.id === activeSectionId))
        setActiveSectionId(song.sections[0]?.id ?? null)
      toast('Earlier version restored.', 'success')
      void refreshRevisions()
    } catch (e) {
      if (e instanceof ApiFail && e.code === 'LOCKED_LINES') {
        toast(
          `Not restored: ${e.lineIds.length} locked line(s) would change. Unlock them first.`,
          'error',
        )
      } else toast(e instanceof ApiFail ? e.message : 'Could not restore.', 'error')
    }
  }
  useEffect(() => {
    if (tool === 'history' && phase === 'ready') void refreshRevisions()
  }, [tool, phase, refreshRevisions])

  // ---------------------------------------------------------- keyboard
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e) => {
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    const t = e.target as HTMLElement | null
    const inPad = !!t?.matches?.('[data-line-input]')
    const inOtherField = !!t?.matches?.('input,textarea,select') && !inPad
    if (k === 'escape' && focusMode && !showHelp) {
      setFocusMode(false)
    } else if (mod && k === 's') {
      e.preventDefault()
      void saveNow().then((ok) =>
        toast(ok ? 'Saved.' : 'Could not save yet.', ok ? 'success' : 'error'),
      )
    } else if (mod && k === '/') {
      e.preventDefault()
      setShowHelp((v) => !v)
    } else if (e.altKey && k === 'f') {
      e.preventDefault()
      setFocusMode((v) => !v)
    } else if (mod && (k === 'z' || k === 'y') && !inOtherField) {
      e.preventDefault()
      if (k === 'y' || e.shiftKey) redo()
      else undo()
    } else if (mod && k === 'l' && inPad && activeLineId) {
      e.preventDefault()
      void toggleLock(activeLineId)
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // keep the active line visible when the on-screen keyboard opens
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const h = () => {
      const el = document.activeElement as HTMLElement | null
      if (el?.matches?.('[data-line-input]'))
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    vv.addEventListener('resize', h)
    return () => vv.removeEventListener('resize', h)
  }, [])

  // ---------------------------------------------------------- render
  if (phase === 'loading')
    return (
      <main className="page">
        <p className="state" role="status">
          Opening song…
        </p>
      </main>
    )
  if (phase === 'missing')
    return (
      <main className="page">
        <div className="state">
          <h2>Song not found</h2>
          <p>
            It may have been deleted. Deleted songs can be restored from the trash on the song list.
          </p>
          <button className="btn btn-primary" onClick={goHome}>
            Back to my songs
          </button>
        </div>
      </main>
    )
  if (phase === 'error' || !meta || !section)
    return (
      <main className="page">
        <div className="state state-error" role="alert">
          <p>{loadError || 'This song could not be opened.'}</p>
          <button className="btn" onClick={() => void load()}>
            Try again
          </button>
          <button className="btn btn-ghost" onClick={goHome}>
            Back to my songs
          </button>
        </div>
      </main>
    )

  const activeLine = activeLineId ? findLine(content, activeLineId) : null
  const sectionIdx = content.findIndex((s) => s.id === section.id)

  /** Rescue: save what is on screen as a NEW song, so nothing typed here is lost in a conflict. */
  async function keepCopy() {
    if (!meta) return
    setCopying(true)
    try {
      const copy = await api.createSong({
        title: `${meta.title} (my copy)`.slice(0, 200),
        genres: meta.genres,
        bpm: meta.bpm,
        time_signature: meta.time_signature,
        template: 'blank',
      })
      const fresh = contentRef.current.map((sec) => ({
        ...sec,
        id: newId(),
        lines: sec.lines.map((l) => ({ ...l, id: newId(), is_locked: false, comments: [] })),
      }))
      await api.saveContent(copy.id, copy.version, fresh)
      setCopyId(copy.id)
      toast(`Your version was saved as a new song: “${meta.title} (my copy)”.`, 'success')
    } catch (e) {
      toast(e instanceof ApiFail ? e.message : 'Could not make the copy.', 'error')
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className={`editor${focusMode ? ' focus' : ''}`}>
      <header className="ed-top">
        <button
          className="btn btn-ghost"
          onClick={async () => {
            await saveNow()
            goHome()
          }}
          aria-label="Back to my songs"
        >
          ←
        </button>
        <input
          className="title-input"
          aria-label="Song title"
          value={meta.title}
          maxLength={200}
          onChange={(e) => changeMeta({ title: e.target.value })}
          onBlur={() => !meta.title.trim() && load()}
        />
        <span className={`save save-${status}`} role="status" aria-live="polite">
          {STATUS_TEXT[status]}
        </span>
        <button
          className="btn btn-ghost"
          onClick={undo}
          disabled={!hist.canUndo}
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
        >
          ↶
        </button>
        <button
          className="btn btn-ghost"
          onClick={redo}
          disabled={!hist.canRedo}
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
        >
          ↷
        </button>
        <button
          className={`btn btn-ghost${focusMode ? ' on' : ''}`}
          onClick={() => setFocusMode((v) => !v)}
          aria-pressed={focusMode}
          title="Focus Mode (Alt+F)"
        >
          {focusMode ? 'Exit focus' : 'Focus'}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => setShowHelp(true)}
          aria-label="Keyboard shortcuts"
          title="Shortcuts (Ctrl+/)"
        >
          ⌨
        </button>
      </header>

      {status === 'conflict' && (
        <div className="banner banner-error" role="alert">
          <span>
            This song was changed in another window or tab, so saving is paused to avoid overwriting
            it. Nothing you typed here is lost yet.
          </span>
          <div className="actions">
            {copyId ? (
              <button className="btn btn-primary" onClick={() => goSong(copyId)}>
                Open my copy
              </button>
            ) : (
              <button
                className="btn btn-primary"
                disabled={copying}
                onClick={() => void keepCopy()}
              >
                Keep my version as a copy
              </button>
            )}
            <button className="btn" onClick={() => void load()}>
              {copyId ? 'Load the latest here' : 'Load the latest (discard what I typed here)'}
            </button>
          </div>
        </div>
      )}
      {status === 'offline' && (
        <div className="banner" role="status">
          Offline. Your writing is safe in this window and will save when the server is reachable.
        </div>
      )}

      <SessionStrip songLink={songLink} />
      <div className="ed-grid">
        <section className="ed-main" aria-label="Lyrics">
          <div className="opts hide-focus">
            <button
              type="button"
              className="btn btn-ghost opts-toggle"
              aria-expanded={optsOpen}
              onClick={() => setOptsOpen((v) => !v)}
            >
              {optsOpen ? 'Hide' : 'Show'} song &amp; section options
            </button>
            {optsOpen && (
              <>
                <div className="meta-row hide-focus">
                  <GenrePicker value={meta.genres} onChange={(genres) => changeMeta({ genres })} />
                  <label className="mini-field">
                    BPM
                    <input
                      className="input input-sm"
                      inputMode="numeric"
                      aria-label="BPM"
                      value={meta.bpm ?? ''}
                      onChange={(e) => {
                        const d = e.target.value.replace(/\D/g, '').slice(0, 3)
                        const n = d === '' ? null : Number(d)
                        if (n === null || (n >= 30 && n <= 300)) changeMeta({ bpm: n })
                        else setMeta((m) => (m ? { ...m, bpm: n } : m))
                      }}
                      onBlur={() => {
                        if (meta.bpm !== null && (meta.bpm < 30 || meta.bpm > 300)) {
                          toast('BPM must be 30 to 300.', 'error')
                          void load()
                        }
                      }}
                    />
                  </label>
                  <label className="mini-field">
                    Time
                    <select
                      className="input input-sm"
                      aria-label="Time signature"
                      value={meta.time_signature ?? ''}
                      onChange={(e) => changeMeta({ time_signature: e.target.value || null })}
                    >
                      <option value="">—</option>
                      {['4/4', '3/4', '6/8', '12/8', '2/4'].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            )}
          </div>
          <div className="tabs hide-focus" role="tablist" aria-label="Sections">
            {content.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={s.id === section.id}
                className={`tab${s.id === section.id ? ' on' : ''}`}
                onClick={() => setActiveSectionId(s.id)}
              >
                {s.label}
              </button>
            ))}
            {addingSection === null ? (
              <button className="tab" onClick={() => setAddingSection('')}>
                + Section
              </button>
            ) : (
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  sectionOps.add(addingSection || 'New section')
                  setAddingSection(null)
                }}
              >
                <input
                  className="input input-sm"
                  autoFocus
                  aria-label="New section name"
                  placeholder="e.g. Pre-Chorus"
                  value={addingSection}
                  maxLength={60}
                  onChange={(e) => setAddingSection(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setAddingSection(null)}
                />
                <button className="btn">Add</button>
              </form>
            )}
          </div>

          {optsOpen && (
            <div className="sec-tools hide-focus">
              {renaming === section.id ? (
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const v = new FormData(e.currentTarget).get('label') as string
                    sectionOps.rename(section.id, v)
                    setRenaming(null)
                  }}
                >
                  <input
                    name="label"
                    className="input input-sm"
                    aria-label="Section name"
                    defaultValue={section.label}
                    maxLength={60}
                    autoFocus
                    onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                  />
                  <button className="btn">Save name</button>
                </form>
              ) : (
                <button className="btn btn-ghost" onClick={() => setRenaming(section.id)}>
                  Rename
                </button>
              )}
              <select
                className="input input-sm"
                aria-label="Section type"
                value={section.section_type}
                onChange={(e) => sectionOps.type(section.id, e.target.value as SectionType)}
              >
                {SECTION_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <button
                className="btn btn-ghost"
                disabled={sectionIdx === 0}
                onClick={() => sectionOps.move(section.id, -1)}
                aria-label="Move section left"
              >
                ←
              </button>
              <button
                className="btn btn-ghost"
                disabled={sectionIdx === content.length - 1}
                onClick={() => sectionOps.move(section.id, 1)}
                aria-label="Move section right"
              >
                →
              </button>
              {confirmDelSection ? (
                <span className="confirm">
                  Delete this section?
                  <button
                    className="btn btn-danger"
                    onClick={() => {
                      sectionOps.remove(section.id)
                      setConfirmDelSection(false)
                    }}
                  >
                    Yes, delete
                  </button>
                  <button className="btn btn-ghost" onClick={() => setConfirmDelSection(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button className="btn btn-ghost" onClick={() => setConfirmDelSection(true)}>
                  Delete section
                </button>
              )}
            </div>
          )}
          {optsOpen && (
            <div className="pad-tools hide-focus" role="group" aria-label="Pad display">
              <span className="seg" role="group" aria-label="Margin numbers">
                <button
                  className={pad.syllableDisplay === 'syllables' ? 'on' : ''}
                  aria-pressed={pad.syllableDisplay === 'syllables'}
                  onClick={() => pad.update({ syllableDisplay: 'syllables' })}
                >
                  Syllables
                </button>
                <button
                  className={pad.syllableDisplay === 'numbers' ? 'on' : ''}
                  aria-pressed={pad.syllableDisplay === 'numbers'}
                  onClick={() => pad.update({ syllableDisplay: 'numbers' })}
                >
                  Line numbers
                </button>
              </span>
              <span className="seg" role="group" aria-label="Rhyme colours">
                {(
                  [
                    ['off', 'Colours off'],
                    ['end', 'End rhymes'],
                    ['all', 'All rhymes'],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    className={pad.highlight === m ? 'on' : ''}
                    aria-pressed={pad.highlight === m}
                    onClick={() => pad.update({ highlight: m })}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </div>
          )}
          <Pad
            section={section}
            activeLineId={activeLineId}
            focusReq={focusReq}
            onText={onText}
            onSplit={(lid, s, e) => applyEdit(splitLine(contentRef.current, lid, s, e))}
            onBackspaceEmpty={(lid) => applyEdit(removeLine(contentRef.current, lid))}
            onMergeUp={(lid) => {
              if (!applyEdit(mergeUp(contentRef.current, lid))) blocked()
            }}
            onPaste={(lid, s, e, text) => {
              const r = pasteLines(contentRef.current, lid, s, e, text)
              if (r === null) return false
              if (r === 'blocked') {
                blocked()
                return true
              }
              return applyEdit(r) || true
            }}
            onActive={(lid) => {
              setActiveLineId(lid)
              const f = findLine(contentRef.current, lid)
              const w = f ? lastWord(f.line.text) : ''
              if (w) setLookup({ word: w, nonce: Date.now() })
            }}
            analysis={analysis}
            syllableDisplay={syllableDisplay}
            highlight={highlight}
            onSelectWord={(w) => setLookup({ word: w, nonce: Date.now() })}
            onToggleLock={(lid) => void toggleLock(lid)}
            onBlocked={blocked}
            onNotes={(lid) => {
              setActiveLineId(lid)
              setTool('notes')
              setToolsOpen(true)
            }}
          />
          <div className="line-actions hide-focus">
            <button
              className="btn"
              disabled={!activeLine}
              onClick={() =>
                activeLine && applyEdit(addLineAfter(contentRef.current, activeLine.line.id))
              }
            >
              + Line below
            </button>
            <button
              className="btn"
              disabled={!activeLine || activeLine.line.is_locked || section.lines.length <= 1}
              onClick={() => {
                if (activeLine) {
                  applyEdit(removeLine(contentRef.current, activeLine.line.id))
                }
              }}
            >
              Delete line
            </button>
            <button
              className="btn"
              disabled={!activeLine}
              onClick={() => activeLine && void toggleLock(activeLine.line.id)}
            >
              {activeLine?.line.is_locked ? 'Unlock line' : 'Lock line'}
            </button>
          </div>
          <p className="hint hide-focus">
            {syllableDisplay === 'syllables'
              ? 'Margin numbers are estimated syllables, not bar numbers. A range means the line can be said more than one way; ~ means a guess.'
              : 'Margin numbers are line positions, not bar numbers.'}
          </p>
          {analysis.failed && !LOCAL && (
            <p className="hint hide-focus" role="status">
              Syllable counts and rhyme colours are paused: the Studio Bars server cannot be
              reached.
            </p>
          )}
          {analysis.unknown.length > 0 && (
            <p className="hint hide-focus">
              Guessing how these sound: <b>{analysis.unknown.slice(0, 5).join(', ')}</b>.{' '}
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setLookup({ word: analysis.unknown[0], nonce: Date.now() })
                  setTool('rhymes')
                  setToolsOpen(true)
                }}
              >
                Teach the app
              </button>
            </p>
          )}
        </section>

        <aside className={`ed-side hide-focus${toolsOpen ? ' open' : ''}`} aria-label="Tools">
          <div className="side-tabs" role="tablist">
            {(
              (LOCAL
                ? ['notes', 'rhymes', 'words', 'ai', 'craft', 'music', 'history', 'files']
                : [
                    'notes',
                    'rhymes',
                    'words',
                    'ai',
                    'craft',
                    'music',
                    'history',
                    'files',
                  ]) as Tool[]
            ).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tool === t}
                className={`tab${tool === t ? ' on' : ''}`}
                onClick={() => {
                  setTool(t)
                  setToolsOpen(true)
                }}
              >
                {t === 'notes'
                  ? 'Notes'
                  : t === 'rhymes'
                    ? 'Rhymes'
                    : t === 'words'
                      ? 'Words'
                      : t === 'ai'
                        ? 'AI'
                        : t === 'craft'
                          ? 'Craft'
                          : t === 'music'
                            ? 'Music'
                            : t === 'history'
                              ? 'History'
                              : 'Export'}
              </button>
            ))}
            <button
              className="btn btn-ghost side-toggle"
              onClick={() => setToolsOpen((v) => !v)}
              aria-expanded={toolsOpen}
            >
              {toolsOpen ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="side-body">
            {tool === 'notes' && (
              <NotesPanel
                line={activeLine?.line ?? null}
                lineNumber={(activeLine?.i ?? 0) + 1}
                onSong={(s) => hist.patch((c) => mergeServerMeta(c, s.sections))}
              />
            )}
            {tool === 'rhymes' && (
              <RhymePanel
                suggested={lookup}
                phraseRequest={phraseReq}
                onPhraseHandled={clearPhraseReq}
                onCustomChanged={() => setAnalysisNonce((n) => n + 1)}
              />
            )}
            {tool === 'words' && (
              <WordsPanel
                suggested={lookup}
                context={lineContext}
                around={aroundContext}
                contextKey={activeLineId ?? ''}
                onLookup={(w) => setLookup({ word: w, nonce: Date.now() })}
                onOpenRhymes={(w) => {
                  setLookup({ word: w, nonce: Date.now() })
                  setTool('rhymes')
                }}
                onPhraseRhymes={(ph) => {
                  setPhraseReq({ phrase: ph, nonce: Date.now() })
                  setTool('rhymes')
                }}
              />
            )}
            {tool === 'ai' && (
              <AiPanel
                songId={id}
                sectionId={section?.id ?? null}
                sectionLabel={section?.label ?? ''}
                activeLine={
                  activeLine && section?.lines.some((l) => l.id === activeLine.line.id)
                    ? {
                        id: activeLine.line.id,
                        text: activeLine.line.text,
                        locked: activeLine.line.is_locked,
                        number: activeLine.i + 1,
                      }
                    : null
                }
                lastLineId={section?.lines[section.lines.length - 1]?.id ?? null}
                saveNow={saveNow}
                lineText={(lid) => findLine(contentRef.current, lid)?.line.text ?? null}
                onInsert={(text, after) =>
                  !!section &&
                  applyEdit(insertLineWithText(contentRef.current, section.id, after, text))
                }
                onReplace={(lid, text) => apply(setLineText(contentRef.current, lid, text))}
              />
            )}
            {tool === 'craft' && (
              <CraftPanel
                songId={id}
                sectionLines={section?.lines ?? NO_LINES}
                activeLine={
                  activeLine && section?.lines.some((l) => l.id === activeLine.line.id)
                    ? {
                        id: activeLine.line.id,
                        text: activeLine.line.text,
                        locked: activeLine.line.is_locked,
                        number: activeLine.i + 1,
                      }
                    : null
                }
                bpm={meta?.bpm ?? null}
                onInsert={(text, after) =>
                  !!section &&
                  applyEdit(insertLineWithText(contentRef.current, section.id, after, text))
                }
                onReplace={(lid, text) => apply(setLineText(contentRef.current, lid, text))}
              />
            )}
            {tool === 'music' && <SongMusicPanel songLink={songLink} />}
            {tool === 'history' && (
              <HistoryPanel revisions={revisions} onSnapshot={onSnapshot} onRestore={onRestore} />
            )}
            {tool === 'files' && <FilesPanel songId={id} />}
          </div>
        </aside>
      </div>

      {focusMode && (
        <button className="btn focus-exit" onClick={() => setFocusMode(false)}>
          Exit focus (Esc)
        </button>
      )}
      {showHelp && (
        <Modal title="Keyboard shortcuts" onClose={() => setShowHelp(false)}>
          <table className="keys">
            <tbody>
              {SHORTCUTS.map(([k, d]) => (
                <tr key={k}>
                  <th scope="row">
                    <kbd>{k}</kbd>
                  </th>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  )
}
