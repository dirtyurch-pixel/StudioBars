/**
 * Meanings, synonyms, opposites and related ideas for a word, from WordNet only (no AI, no internet).
 * A faithful port of backend/app/lexicon/service.py.
 */
import { readableIpa, type Dictionary } from '../phonetics/engine'
import { STOPWORDS, tokenize } from '../phonetics/words'
import { saidAs } from './heteronyms'
import { POS_LABEL, type Pos, type Synset, type WordNet } from './wordnet'

export const SOURCE = 'WordNet 3.0, Princeton University'
const LIMITS = { synonyms: 14, antonyms: 8, broader: 8, narrower: 14, related: 10, imagery: 14 }
const HYPERNYM = new Set(['@', '@i'])
const HYPONYM = new Set(['~', '~i'])
const SIMILAR = '&'
const ALSO = '^'
const ATTRIBUTE = '='
const PERTAIN = '\\'
const MERONYMS = new Set(['%p', '%m', '%s'])

type Chip = {
  word: string
  shift?: { rank: number; of: number; usually_means: string }
  via?: string
}

export class Lexicon {
  constructor(
    public wn: WordNet,
    public dic: Dictionary | null,
  ) {}

  private zipf(word: string) {
    return this.dic?.zipf(word.toLowerCase()) ?? 0
  }

  private targets(syn: Synset, symbols: Set<string>, wholeOnly = true): Synset[] {
    return syn.pointers
      .filter((p) => symbols.has(p.symbol) && (!wholeOnly || p.source === 0))
      .map((p) => this.wn.synset(p.pos, p.offset))
  }

  private names(synsets: Synset[], exclude: Set<string>, cap: number): Chip[] {
    const seen = new Set<string>()
    const items: { word: string; zipf: number }[] = []
    for (const s of synsets) {
      for (const w of s.words.slice(0, 2)) {
        const k = w.toLowerCase()
        if (!seen.has(k) && !exclude.has(k)) {
          seen.add(k)
          items.push({ word: w, zipf: this.zipf(w) })
          break
        }
      }
    }
    return stableSort(items, (a, b) => b.zipf - a.zipf)
      .slice(0, cap)
      .map((i) => ({ word: i.word }))
  }

  private antonyms(syn: Synset, lemma: string): Chip[] {
    const found = new Map<string, string | null>()
    const idxs = syn.words
      .map((w, i) => (w.toLowerCase() === lemma.toLowerCase() ? i + 1 : 0))
      .filter(Boolean)
    const collect = (s: Synset, only: number[] | null, via: string | null) => {
      for (const p of s.pointers) {
        if (p.symbol === '!' && (only === null || only.includes(p.source))) {
          const t = this.wn.synset(p.pos, p.offset)
          const w = p.target > 0 && p.target <= t.words.length ? t.words[p.target - 1] : t.words[0]
          if (!found.has(w)) found.set(w, via)
        }
      }
    }
    collect(syn, idxs.length ? idxs : null, null)
    if (!found.size && syn.satellite)
      for (const head of this.targets(syn, new Set([SIMILAR]))) collect(head, null, head.words[0])
    return [...found]
      .slice(0, LIMITS.antonyms)
      .map(([w, v]) => (v ? { word: w, via: v } : { word: w }))
  }

  private withShift(pos: Pos, offset: number, w: string): Chip & { zipf: number } {
    const item: Chip & { zipf: number } = { word: w, zipf: this.zipf(w) }
    const rk = this.wn.senseRank(pos, w, offset)
    if (rk && rk[0] > 1) {
      const first = this.wn.firstSense(pos, w)
      item.shift = {
        rank: rk[0],
        of: rk[1],
        usually_means: first ? first.definition.slice(0, 110) : '',
      }
    }
    return item
  }

  private rankChips(items: (Chip & { zipf: number })[]): Chip[] {
    return stableSort(
      items,
      (a, b) => Number('shift' in a) - Number('shift' in b) || b.zipf - a.zipf,
    )
      .slice(0, LIMITS.synonyms)
      .map(({ zipf: _z, ...rest }) => {
        void _z
        return rest
      })
  }

  private synonyms(syn: Synset, lemma: string): Chip[] {
    return this.rankChips(
      syn.words
        .filter((w) => w.toLowerCase() !== lemma.toLowerCase())
        .map((w) => this.withShift(syn.pos, syn.offset, w)),
    )
  }

  private similar(syn: Synset, lemma: string): Chip[] {
    if (syn.pos !== 'a') return []
    const heads = syn.satellite ? this.targets(syn, new Set([SIMILAR])) : [syn]
    const groups: Synset[] = []
    for (const h of heads) {
      groups.push(h)
      groups.push(...this.targets(h, new Set([SIMILAR])))
    }
    const seen = new Set([lemma.toLowerCase()])
    const items: (Chip & { zipf: number })[] = []
    for (const g of groups)
      for (const w of g.words) {
        if (seen.has(w.toLowerCase())) continue
        seen.add(w.toLowerCase())
        items.push(this.withShift(g.pos, g.offset, w))
      }
    return this.rankChips(items)
  }

  private terms(text: string): Set<string> {
    const out = new Set<string>()
    for (const m of text.toLowerCase().matchAll(/[a-z]+/g)) {
      const w = m[0]
      if (w.length < 3 || STOPWORDS.has(w)) continue
      out.add(w)
      for (const pos of ['n', 'v', 'a'] as const) for (const x of this.wn.morphy(w, pos)) out.add(x)
    }
    return out
  }

  private signature(syn: Synset): Set<string> {
    let text = [syn.definition, ...syn.examples, ...syn.words].join(' ')
    for (const h of this.targets(syn, HYPERNYM)) text += ' ' + h.words.join(' ')
    return this.terms(text)
  }

  describe(word: string, context = '', pos: Pos | null = null, around = '') {
    const wn = this.wn
    const raw = wn.senses(word, pos)
    const usage = (p: Pos): [number, number] => {
      const lemmas = wn.morphy(word, p)
      return [
        lemmas.length ? Math.max(...lemmas.map((lm) => wn.index[p].get(lm)![0])) : -1,
        lemmas.length ? Math.max(...lemmas.map((lm) => wn.index[p].get(lm)![1].length)) : 0,
      ]
    }
    const posOrder = (['n', 'v', 'a', 'r'] as Pos[]).sort((x, y) => {
      const a = usage(x)
      const b = usage(y)
      return b[0] - a[0] || b[1] - a[1] || 'nvar'.indexOf(x) - 'nvar'.indexOf(y)
    })
    const rank = new Map(posOrder.map((p, i) => [p, i]))
    const sortedRaw = stableSort(raw, (a, b) => rank.get(a[0])! - rank.get(b[0])!)
    const forms = [...new Set(sortedRaw.map((t) => t[1]))].sort()
    const posCounts: Record<string, number> = {}
    for (const p of 'nvar' as unknown as Pos[]) {
      const n = sortedRaw.filter((t) => t[0] === p).length
      if (n) posCounts[POS_LABEL[p]] = n
    }
    const out = {
      word: word.toLowerCase(),
      found: sortedRaw.length > 0,
      forms: forms.map((f) => f.replace(/_/g, ' ')),
      senses: [] as Record<string, unknown>[],
      pos_counts: posCounts,
      total_senses: sortedRaw.length,
      context_used: false,
      reordered: false,
      notes: [] as string[],
      source: SOURCE,
    }
    if (!sortedRaw.length) {
      out.notes.push(
        `WordNet does not have “${word}”. It may be slang, a name, or spelled differently.`,
      )
      return out
    }
    const own = this.terms(forms.join(' '))
    own.add(word.toLowerCase())
    const minus = (a: Set<string>, ...bs: Set<string>[]) =>
      new Set([...a].filter((x) => !bs.some((b) => b.has(x))))
    const ctx = context.trim()
      ? minus(
          this.terms(
            tokenize(context)
              .map((t) => t.norm)
              .join(' '),
          ),
          own,
        )
      : new Set<string>()
    const near = around.trim()
      ? minus(
          this.terms(
            tokenize(around)
              .map((t) => t.norm)
              .join(' '),
          ),
          own,
          ctx,
        )
      : new Set<string>()
    const useContext = ctx.size > 0 || near.size > 0
    type Sense = Record<string, unknown> & {
      id: string
      fit: { score: number; matched: string[]; best: boolean } | null
      said_as: { phones: string } | null
      _order: number
    }
    let senses: Sense[] = sortedRaw.map(([p, lemma, no, syn], order) => {
      const lem = lemma.replace(/_/g, ' ')
      const phones = saidAs(lemma, p, syn.definition)
      const sense: Sense = {
        id: syn.id,
        pos: p,
        pos_label: POS_LABEL[p],
        sense_no: no,
        of: wn.index[p].get(lemma)![1].length,
        lemma: lem,
        definition: syn.definition,
        examples: syn.examples.slice(0, 3),
        synonyms: this.synonyms(syn, lem),
        similar: this.similar(syn, lem),
        antonyms: this.antonyms(syn, lem),
        broader: this.names(this.targets(syn, HYPERNYM), own, LIMITS.broader),
        narrower: this.names(this.targets(syn, HYPONYM), own, LIMITS.narrower),
        related: this.names(
          this.targets(syn, new Set([SIMILAR, ALSO, ATTRIBUTE, PERTAIN])),
          own,
          LIMITS.related,
        ),
        imagery: this.names(this.targets(syn, MERONYMS), own, LIMITS.imagery),
        said_as: null,
        fit: null,
        _order: order,
      }
      if (phones) {
        const ph = phones.split(' ')
        const known = (this.dic?.prons.get(lemma) ?? []).some((x) => x.join(' ') === ph.join(' '))
        sense.said_as = { phones, ipa: readableIpa(ph), in_dictionary: known } as Sense['said_as']
      }
      if (useContext) {
        const sig = this.signature(syn)
        const ownHits = [...ctx].filter((x) => sig.has(x)).sort()
        const nearHits = [...near].filter((x) => sig.has(x)).sort()
        sense.fit = {
          score: 2 * ownHits.length + nearHits.length,
          matched: [...ownHits, ...nearHits].slice(0, 4),
          best: false,
        }
      }
      return sense
    })
    if (useContext) {
      out.context_used = true
      const ranked = stableSort(
        senses,
        (a, b) => b.fit!.score - a.fit!.score || a._order - b._order,
      )
      const top = ranked[0].fit!.score
      if (top > 0) {
        if (ranked.length > 1 && top > ranked[1].fit!.score) ranked[0].fit!.best = true
        out.reordered = ranked.map((s) => s.id).join() !== senses.map((s) => s.id).join()
        senses = ranked
      }
    }
    out.senses = senses.map(({ _order: _o, ...s }) => {
      void _o
      return s
    })
    if (new Set(senses.filter((s) => s.said_as).map((s) => s.said_as!.phones)).size > 1)
      out.notes.push(
        'This word is said differently depending on its meaning. Each meaning shows how it is said.',
      )
    return out
  }
}

function stableSort<T>(arr: T[], cmp: (a: T, b: T) => number): T[] {
  return arr
    .map((v, i) => [v, i] as const)
    .sort((a, b) => cmp(a[0], b[0]) || a[1] - b[1])
    .map(([v]) => v)
}
