/**
 * The phone version's dictionaries: downloaded once from the app's own address (the first time a rhyme
 * or word tool is used), then kept by the browser so they work offline. Nothing else is contacted.
 */
import { Dictionary, parseDict, parseFrequency } from './phonetics/engine'
import { WordNet, POS_FILE, POS_ORDER, type Pos } from './lexicon/wordnet'

export type DataSource = {
  text(name: string): Promise<string>
  bytes(name: string): Promise<Uint8Array>
}

const base = () => `${import.meta.env.BASE_URL}data/`
async function get(name: string) {
  const res = await fetch(base() + name)
  if (!res.ok) throw new Error(`Could not load ${name} (${res.status}).`)
  return res
}
let source: DataSource = {
  text: async (n) => (await get(n)).text(),
  bytes: async (n) => new Uint8Array(await (await get(n)).arrayBuffer()),
}
/** Tests point this at files on disk instead of the web. */
export function setDataSource(s: DataSource) {
  source = s
  dict = null
  wordnet = null
}

let dict: Promise<Dictionary> | null = null
let wordnet: Promise<WordNet> | null = null

export function loadDictionary(): Promise<Dictionary> {
  if (!dict) {
    dict = Promise.all([
      source.text('cmudict.txt'),
      source.text('frequency_en.txt').catch(() => ''),
    ]).then(([d, f]) => new Dictionary(parseDict(d), parseFrequency(f)))
    dict.catch(() => (dict = null)) // try again next time if the download failed
  }
  return dict
}

export function loadWordNet(): Promise<WordNet> {
  if (!wordnet) {
    const one = (p: Pos) =>
      Promise.all([
        source.text(`wordnet/index.${POS_FILE[p]}.txt`),
        source.text(`wordnet/${POS_FILE[p]}.exc.txt`),
        source.bytes(`wordnet/data.${POS_FILE[p]}.txt`),
      ])
    wordnet = Promise.all(POS_ORDER.map(one)).then((parts) => {
      const files = { index: {}, exc: {}, data: {} } as ConstructorParameters<typeof WordNet>[0]
      POS_ORDER.forEach((p, i) => {
        files.index[p] = parts[i][0]
        files.exc[p] = parts[i][1]
        files.data[p] = parts[i][2]
      })
      return new WordNet(files)
    })
    wordnet.catch(() => (wordnet = null))
  }
  return wordnet
}
