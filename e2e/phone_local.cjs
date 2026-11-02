/* The independent phone version: built as plain files, NO server. Songs live on the device (IndexedDB). */
const { chromium, devices } = require('playwright')
const fs = require('fs')

const URL_ = process.env.PHONE_LOCAL_URL || 'http://127.0.0.1:4174/StudioBars/'
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const line = (p, n) => p.getByLabel(new RegExp(`^Line ${n}( \\(locked\\))?$`))
let CURRENT = null

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true })
  const page = await ctx.newPage()
  CURRENT = page
  const errors = []
  const apiCalls = []
  const hosts = new Set()
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('request', (r) => {
    const u = new URL(r.url())
    hosts.add(u.host)
    if (u.pathname.includes('/api/')) apiCalls.push(u.pathname)
  })

  await page.goto(URL_)
  await page.getByText('Saved on this device.').waitFor()
  check('opens with no server and says songs are saved on this device', true)
  await page.getByRole('button', { name: '+ New song' }).first().click()
  await page.getByLabel('Title').fill('Phone Only')
  await page.getByRole('button', { name: 'Create song' }).click()
  await line(page, 1).waitFor()
  await line(page, 1).fill('Written on my phone')
  await line(page, 2).fill('No computer needed')
  await page.getByText('Saved', { exact: true }).first().waitFor()
  check('no confusing "server cannot be reached" message on the phone', (await page.getByText(/server cannot be reached/).count()) === 0)
  const tabs = await page.getByRole('tablist').last().getByRole('tab').allInnerTexts()
  check('only the tools that work on the phone are shown', JSON.stringify(tabs) === JSON.stringify(['Notes', 'Rhymes', 'Words', 'History', 'Export']), JSON.stringify(tabs))

  // lock
  await line(page, 1).click()
  await page.getByRole('button', { name: 'Lock line', exact: true }).click()
  await page.getByLabel('Line 1 (locked)').waitFor()
  await page.getByLabel('Line 1 (locked)').click()
  await page.keyboard.type('XYZ')
  await page.keyboard.press('Backspace')
  check('a locked line cannot be typed over', (await page.getByLabel('Line 1 (locked)').inputValue()) === 'Written on my phone')

  // note
  await page.getByRole('button', { name: /^Notes for line 2/ }).click()
  await page.getByRole('tab', { name: 'Notes' }).click()
  const box = page.locator('textarea').first()
  await box.fill('say this softer')
  await page.getByRole('button', { name: /^Add note/ }).click()
  await page.getByText('say this softer').first().waitFor()
  check('notes can be added to a line', true)

  // reload: everything persists on the device
  await page.getByText('Saved', { exact: true }).first().waitFor()
  await sleep(300)
  await page.reload()
  await page.getByLabel('Line 1 (locked)').waitFor()
  check('after reopening, the lyrics, lock and note are still there',
    (await page.getByLabel('Line 1 (locked)').inputValue()) === 'Written on my phone' &&
    (await line(page, 2).inputValue()) === 'No computer needed' &&
    (await page.getByRole('button', { name: /^Notes for line 2 \(1\)/ }).count()) === 1)

  // history
  await page.getByRole('tab', { name: 'History' }).click()
  await page.getByText(/Automatic snapshot/).first().waitFor()
  check('history keeps snapshots on the device', true)

  // offline: keeps working, and the app opens with no connection at all
  await page.evaluate(() => navigator.serviceWorker.ready)
  await ctx.setOffline(true)
  await line(page, 3).fill('Still writing with no signal')
  await page.getByText('Saved', { exact: true }).first().waitFor()
  await sleep(300)
  await page.goto(URL_ + '#/')
  await page.getByText('Phone Only').first().click()
  await line(page, 3).waitFor()
  check('with no internet the app still opens, and what was typed offline is saved', (await line(page, 3).inputValue()) === 'Still writing with no signal')
  await ctx.setOffline(false)

  // export a song
  await page.getByRole('tab', { name: 'Export' }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Full backup/ }).click()])
  const json = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'))
  check('a song can be exported as a file (same format as the PC version)', json.format === 'studio-bars-song' && json.sections[0].lines[0].is_locked === true)

  // backup everything and restore it
  await page.getByLabel('Back to my songs').click()
  const [bk] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up all songs' }).click()])
  const backupPath = await bk.path()
  check('back up all songs gives one file', JSON.parse(fs.readFileSync(backupPath, 'utf8')).songs.length === 1)
  await page.getByLabel('Backup file').setInputFiles(backupPath)
  await page.getByText(/Added 1 song from the backup/).waitFor()
  check('restoring a backup adds the songs without touching the existing ones', (await page.locator('.song-card').count()) === 2)

  // import text
  await page.getByRole('button', { name: 'Import' }).click()
  await page.locator('#im-text').fill('[Verse]\nimported line\n[Chorus]\nhook line')
  await page.getByLabel('Title (optional)').fill('Imported Here')
  await page.getByRole('button', { name: 'Preview' }).click()
  await page.getByLabel('Import preview').waitFor()
  await page.getByRole('button', { name: 'Import as new song' }).click()
  await line(page, 1).waitFor()
  check('importing pasted lyrics works on the phone', (await line(page, 1).inputValue()) === 'imported line')

  const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  check('phone: no sideways scrolling', sw[0] <= sw[1], JSON.stringify(sw))
  check('it never asked any server for songs', apiCalls.length === 0, JSON.stringify(apiCalls.slice(0, 5)))
  check('it never contacted any other website', [...hosts].every((h) => h.startsWith('127.0.0.1') || h.startsWith('localhost')), JSON.stringify([...hosts]))
  check('no uncaught page errors', errors.length === 0, errors.join(' | '))

  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} phone-version browser checks passed`)
  process.exit(failed.length ? 1 : 0)
})().catch(async (e) => {
  if (CURRENT) console.error('PAGE TEXT:', ((await CURRENT.locator('body').innerText({ timeout: 2000 }).catch(() => '(unreadable)')) || '').replace(/\s+/g, ' ').slice(0, 700))
  console.error('PHONE E2E CRASHED:', e.message.split('\n')[0], '\n', (e.stack || '').split('\n').filter((l) => l.includes('phone_local.cjs')).slice(0, 3).join('\n'))
  process.exit(2)
})
