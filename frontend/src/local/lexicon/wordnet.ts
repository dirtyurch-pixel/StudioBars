/**
 * Princeton WordNet 3.0 read straight from the original (unmodified) files, for the phone version.
 * A faithful port of backend/app/lexicon/wordnet.py. Data files are kept as bytes and read by byte offset.
 */
export const POS_ORDER = ['n', 'v', 'a', 'r'] as const
export type Pos = (typeof POS_ORDER)[number]
export const POS_FILE: Record<Pos, string> = { n: 'noun', v: 'verb', a: 'adj', r: 'adv' }
export const POS_LABEL: Record<Pos, string> = { n: 'noun', v: 'verb', a: 'adjective', r: 'adverb' }
export const POS_FROM_NAME: Record<string, Pos> = {
  noun: 'n',
  verb: 'v',
  adjective: 'a',
  adverb: 'r',
}

const RULES: Record<Pos, [string, string][]> = {
  n: [
    ['s', ''],
    ['ses', 's'],
    ['ves', 'f'],
    ['xes', 'x'],
    ['zes', 'z'],
    ['ches', 'ch'],
    ['shes', 'sh'],
    ['men', 'man'],
    ['ies', 'y'],
  ],
  v: [
    ['s', ''],
    ['ies', 'y'],
    ['es', 'e'],
    ['es', ''],
    ['ed', 'e'],
    ['ed', ''],
    ['ing', 'e'],
    ['ing', ''],
  ],
  a: [
    ['er', ''],
    ['est', ''],
    ['er', 'e'],
    ['est', 'e'],
  ],
  r: [],
}
const MARKER = /\((?:a|p|ip)\)$/

export type Pointer = { symbol: string; pos: Pos; offset: number; source: number; target: number }
export type Synset = {
  pos: Pos
  offset: number
  words: string[]
  definition: string
  examples: string[]
  pointers: Pointer[]
  satellite: boolean
  id: string
}

const display = (w: string) => w.replace(MARKER, '').replace(/_/g, ' ')

export function parseGloss(gloss: string): [string, string[]] {
  const examples = [...gloss.matchAll(/"([^"]+)"/g)].map((m) => m[1])
  const cut = gloss.indexOf('; "')
  let definition = cut < 0 ? gloss : gloss.slice(0, cut)
  if (definition.startsWith('"') && examples.length) definition = ''
  return [definition.trim(), examples]
}

export function parseSynset(line: string): Synset {
  const bar = line.indexOf(' | ')
  const head = bar < 0 ? line : line.slice(0, bar)
  const gloss = bar < 0 ? '' : line.slice(bar + 3)
  const f = head.split(' ')
  const offset = parseInt(f[0], 10)
  const ssType = f[2]
  const wcnt = parseInt(f[3], 16)
  let i = 4
  const words: string[] = []
  for (let k = 0; k < wcnt; k++) {
    words.push(display(f[i]))
    i += 2
  }
  const pcnt = parseInt(f[i], 10)
  i += 1
  const pointers: Pointer[] = []
  for (let k = 0; k < pcnt; k++) {
    const st = f[i + 3]
    pointers.push({
      symbol: f[i],
      offset: parseInt(f[i + 1], 10),
      pos: (f[i + 2] === 's' ? 'a' : f[i + 2]) as Pos,
      source: parseInt(st.slice(0, 2), 16),
      target: parseInt(st.slice(2), 16),
    })
    i += 4
  }
  const [definition, examples] = parseGloss(gloss.trim())
  const pos = (ssType === 's' ? 'a' : ssType) as Pos
  return {
    pos,
    offset,
    words,
    definition,
    examples,
    pointers,
    satellite: ssType === 's',
    id: `${pos}${String(offset).padStart(8, '0')}`,
  }
}

export type WordNetFiles = {
  index: Record<Pos, string>
  exc: Record<Pos, string>
  data: Record<Pos, Uint8Array>
}

export class WordNet {
  index: Record<Pos, Map<string, [number, number[]]>> = {
    n: new Map(),
    v: new Map(),
    a: new Map(),
    r: new Map(),
  }
  exc: Record<Pos, Map<string, string[]>> = {
    n: new Map(),
    v: new Map(),
    a: new Map(),
    r: new Map(),
  }
  private data: Record<Pos, Uint8Array>
  private cache = new Map<string, Synset>()
  private dec = new TextDecoder()

  constructor(files: WordNetFiles) {
    this.data = files.data
    for (const p of POS_ORDER) {
      const idx = this.index[p]
      for (const line of files.index[p].split('\n')) {
        if (!line || line.startsWith('  ')) continue
        const f = line.trim().split(/\s+/)
        const psyms = parseInt(f[3], 10)
        const tag = parseInt(f[5 + psyms], 10)
        idx.set(f[0], [tag, f.slice(6 + psyms).map((x) => parseInt(x, 10))])
      }
      for (const line of files.exc[p].split('\n')) {
        const f = line.trim().split(/\s+/)
        if (f.length >= 2 && f[0]) this.exc[p].set(f[0], f.slice(1))
      }
    }
  }

  synset(pos: Pos, offset: number): Synset {
    const k = pos + offset
    let s = this.cache.get(k)
    if (!s) {
      const bytes = this.data[pos]
      let end = bytes.indexOf(10, offset)
      if (end < 0) end = bytes.length
      s = parseSynset(this.dec.decode(bytes.subarray(offset, end)))
      if (this.cache.size > 8192) this.cache.clear()
      this.cache.set(k, s)
    }
    return s
  }

  /** Possible base forms of `word` for this part of speech that WordNet knows. */
  morphy(word: string, pos: Pos): string[] {
    const w = word.toLowerCase().trim().replace(/ /g, '_')
    if (!w) return []
    const idx = this.index[pos]
    const found: string[] = []
    const ex = this.exc[pos].get(w)
    if (ex) found.push(...ex.filter((x) => idx.has(x)))
    if (idx.has(w) && !found.includes(w)) found.unshift(w)
    for (const [suffix, repl] of RULES[pos]) {
      if (w.endsWith(suffix) && w.length > suffix.length) {
        const cand = w.slice(0, -suffix.length) + repl
        if (idx.has(cand) && !found.includes(cand)) found.push(cand)
      }
    }
    return found
  }

  senses(word: string, posFilter: Pos | null = null): [Pos, string, number, Synset][] {
    const out: [Pos, string, number, Synset][] = []
    for (const pos of POS_ORDER) {
      if (posFilter && pos !== posFilter) continue
      const seen = new Set<number>()
      for (const lemma of this.morphy(word, pos)) {
        this.index[pos].get(lemma)![1].forEach((off, i) => {
          if (!seen.has(off)) {
            seen.add(off)
            out.push([pos, lemma, i + 1, this.synset(pos, off)])
          }
        })
      }
    }
    return out
  }

  /** The part of speech this word is most often used as (WordNet's tagged-usage counts). */
  usualPos(word: string): Pos | null {
    let best: [number, number] | null = null
    let bestPos: Pos | null = null
    POS_ORDER.forEach((pos, rank) => {
      const lemmas = this.morphy(word, pos)
      if (!lemmas.length) return
      const score = Math.max(...lemmas.map((lm) => this.index[pos].get(lm)![0]))
      const k: [number, number] = [score, -rank]
      if (!best || k[0] > best[0] || (k[0] === best[0] && k[1] > best[1])) {
        best = k
        bestPos = pos
      }
    })
    return bestPos
  }

  senseRank(pos: Pos, lemma: string, offset: number): [number, number] | null {
    const e = this.index[pos].get(lemma.toLowerCase().replace(/ /g, '_'))
    if (!e || !e[1].includes(offset)) return null
    return [e[1].indexOf(offset) + 1, e[1].length]
  }

  firstSense(pos: Pos, lemma: string): Synset | null {
    const e = this.index[pos].get(lemma.toLowerCase().replace(/ /g, '_'))
    return e ? this.synset(pos, e[1][0]) : null
  }
}
