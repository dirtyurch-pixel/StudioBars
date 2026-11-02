/** Theme and lyric text size, remembered per device and applied before the app draws. */
export type Theme = 'dark' | 'light' | 'system'
export type LyricSize = 'small' | 'medium' | 'large' | 'xlarge'

const THEME = 'sb-theme'
const LYRIC = 'sb-lyric-size'

function read(k: string): string | null {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}

export const getTheme = (): Theme => {
  const v = read(THEME)
  return v === 'light' || v === 'system' ? v : 'dark'
}
export const getLyricSize = (): LyricSize => {
  const v = read(LYRIC)
  return v === 'small' || v === 'large' || v === 'xlarge' ? v : 'medium'
}

const media = () => window.matchMedia?.('(prefers-color-scheme: light)')

export function applyAppearance() {
  const t = getTheme()
  const light = t === 'light' || (t === 'system' && !!media()?.matches)
  const root = document.documentElement
  root.dataset.theme = light ? 'light' : 'dark'
  const size = getLyricSize()
  if (size === 'medium') delete root.dataset.lyric
  else root.dataset.lyric = size
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', light ? '#e8e4dc' : '#171717')
}

export function setAppearance(p: { theme?: Theme; lyric?: LyricSize }) {
  try {
    if (p.theme) localStorage.setItem(THEME, p.theme)
    if (p.lyric) localStorage.setItem(LYRIC, p.lyric)
  } catch {
    /* not remembered; still applied for now */
  }
  applyAppearance()
  window.dispatchEvent(new Event('sb-appearance'))
}

media()?.addEventListener?.('change', () => {
  if (getTheme() === 'system') applyAppearance()
})
