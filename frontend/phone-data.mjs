// Copies the dictionaries into the phone build (only when VITE_LOCAL=1). Files are copied unmodified;
// they get a .txt name so GitHub Pages sends them compressed. Licences travel with them.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PH = join(root, 'backend/app/phonetics/data')
const WN = join(root, 'backend/app/lexicon/data/wordnet')
const FILES = [
  [join(PH, 'cmudict.dict'), 'cmudict.txt'],
  [join(PH, 'frequency_en.tsv'), 'frequency_en.txt'],
  [join(root, 'licenses/cmudict-LICENSE.txt'), 'cmudict-LICENSE.txt'],
  [join(root, 'licenses/wordfreq-NOTICE.txt'), 'wordfreq-NOTICE.txt'],
  [join(WN, 'LICENSE'), 'wordnet/LICENSE.txt'],
  ...['noun', 'verb', 'adj', 'adv'].flatMap((p) => [
    [join(WN, `data.${p}`), `wordnet/data.${p}.txt`],
    [join(WN, `index.${p}`), `wordnet/index.${p}.txt`],
    [join(WN, `${p}.exc`), `wordnet/${p}.exc.txt`],
  ]),
]

export function phoneData() {
  let outDir = 'dist'
  return {
    name: 'studio-bars-phone-data',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir)
    },
    closeBundle() {
      if (process.env.VITE_LOCAL !== '1') return
      for (const [from, to] of FILES) {
        const dest = join(outDir, 'data', to)
        mkdirSync(dirname(dest), { recursive: true })
        copyFileSync(from, dest)
      }
    },
  }
}
