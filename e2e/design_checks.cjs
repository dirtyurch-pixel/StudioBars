/* Design A, stage 8: contrast (dark and light), tap targets, keyboard use, zoom, light mode. Phone version. */
const { chromium, devices } = require('playwright')

const URL_ = process.env.PHONE_LOCAL_URL || 'http://127.0.0.1:4174/StudioBars/'
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
}
const line = (p, n) => p.getByLabel(new RegExp(`^Line ${n}( \\(locked\\))?$`))

/** WCAG contrast of the theme's own colour pairs, measured from the live CSS. */
const contrastOf = (page) =>
  page.evaluate(() => {
    const css = getComputedStyle(document.documentElement)
    const probe = document.createElement('i')
    document.body.appendChild(probe)
    const rgb = (v) => {
      probe.style.color = css.getPropertyValue(v).trim()
      return getComputedStyle(probe).color.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
    }
    const lum = ([r, g, b]) => {
      const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const ratio = (a, b) => {
      const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m)
      return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100
    }
    const pairs = {
      'text on background': ['--text', '--bg'],
      'muted text on background': ['--text-muted', '--bg'],
      'muted text on surface': ['--text-muted', '--surface'],
      'text on raised surface': ['--text', '--surface-raised'],
      'button text on orange': ['--accent-text', '--accent'],
      'lyrics on the notebook': ['--paper-ink', '--paper'],
      'numbers on the notebook': ['--paper-muted', '--paper'],
    }
    const out = {}
    for (const [k, [a, b]] of Object.entries(pairs)) out[k] = ratio(a, b)
    probe.remove()
    return out
  })

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['Pixel 7'] })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL_)
  await page.getByRole('heading', { name: 'Your songs' }).waitFor()

  // ---- contrast, both themes (4.5:1 for text; AA)
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => localStorage.setItem('sb-theme', t), theme)
    await page.reload()
    await page.getByRole('heading', { name: 'Your songs' }).waitFor()
    const c = await contrastOf(page)
    const low = Object.entries(c).filter(([, v]) => v < 4.5)
    check(`${theme} theme: every text colour pair reaches 4.5:1 contrast`, low.length === 0, JSON.stringify(c))
  }
  await page.evaluate(() => localStorage.setItem('sb-theme', 'dark'))
  await page.reload()

  // a song to look at
  await page.getByRole('button', { name: '+ New song' }).first().click()
  await page.getByLabel('Title').fill('Checks')
  await page.getByRole('button', { name: 'Create song' }).click()
  await line(page, 1).fill('Keep the lights low')
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByText('Saved', { exact: true }).first().waitFor()

  // ---- tap targets: every visible button on the editor is at least 44px tall or wide enough to hit
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button, [role="tab"], select, input:not([type=hidden]), textarea')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'
      })
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { n: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20), h: Math.round(r.height), w: Math.round(r.width) }
      })
      .filter((x) => x.h < 32 || x.w < 32),
  )
  check('editor on a phone: nothing to tap is smaller than 32px (most are 44px)', small.length === 0, JSON.stringify(small))

  // ---- keyboard only (PC): reach New song and open a song without a mouse
  const pc = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const k = await pc.newPage()
  await k.goto(URL_)
  await k.getByRole('heading', { name: 'Your songs' }).waitFor()
  let reached = false
  for (let i = 0; i < 6 && !reached; i++) {
    await k.keyboard.press('Tab')
    reached = await k.evaluate(() => document.activeElement?.getAttribute('aria-label') === '+ New song')
  }
  check('keyboard: Tab reaches "+ New" near the top of the home screen', reached)
  await k.keyboard.press('Enter')
  await k.getByLabel('Title').waitFor()
  await k.keyboard.type('Keyboard Song')
  await k.keyboard.press('Enter')
  const opened = await line(k, 1).waitFor({ timeout: 10000 }).then(() => true, () => false)
  check('keyboard: a song can be created with the keyboard alone', opened)
  await line(k, 1).focus()
  const ring = await k.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none' || !!document.activeElement.closest('.pad-line.active'))
  check('keyboard: the focused line is clearly marked', ring)
  await k.getByLabel('Song menu').click()
  await k.keyboard.press('Escape')
  check('keyboard: Escape closes a menu', (await k.getByRole('menu').count()) === 0)
  await pc.close()

  // ---- zoom: 200% on a phone is about 320px wide; nothing may scroll sideways
  const z = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true })
  const zp = await z.newPage()
  await zp.goto(URL_)
  await zp.getByRole('heading', { name: 'Your songs' }).waitFor()
  const sw = async () => zp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  check('320px wide (zoomed): home has no sideways scrolling', await sw())
  await zp.getByRole('button', { name: '+ New song' }).first().click()
  await zp.getByLabel('Title').fill('Zoomed In Song With A Long Title')
  await zp.getByRole('button', { name: 'Create song' }).click()
  await line(zp, 1).fill('A long line that has to wrap across the narrow notebook without scrolling')
  await zp.waitForTimeout(500)
  check('320px wide (zoomed): the editor has no sideways scrolling', await sw())
  await zp.getByLabel('Back to my songs').click()
  await zp.getByRole('button', { name: 'Settings' }).click()
  await zp.getByRole('heading', { name: 'Appearance' }).waitFor()
  check('320px wide (zoomed): settings have no sideways scrolling', await sw())
  // the largest lyric size still fits
  await zp.getByRole('button', { name: 'Lyric text size XL' }).click()
  await zp.getByRole('button', { name: '← My songs' }).click()
  await zp.getByText('Zoomed In Song With A Long Title').click()
  await line(zp, 1).waitFor()
  check('largest lyric text: still no sideways scrolling', await sw())
  await z.close()

  // ---- light mode renders the main screens without errors
  await page.evaluate(() => localStorage.setItem('sb-theme', 'light'))
  await page.reload()
  await line(page, 1).waitFor()
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  check('light mode applies (warm light background)', bg === 'rgb(232, 228, 220)', bg)

  check('no page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} design checks passed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
