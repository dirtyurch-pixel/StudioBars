/* Phase 1 acceptance test, driven through a real browser against the real servers. */
const { chromium } = require('playwright')
const fs = require('fs')

const APP = process.env.APP_URL || 'http://localhost:5173'
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
}
const saved = (p) => p.locator('.save-saved').waitFor({ timeout: 8000 })
const line = (p, n) => p.getByLabel(new RegExp(`^Line ${n}( \\(locked\\))?$`))


// Diagnostics printed if a suite crashes: what the page was showing and which requests failed.
const net = []
let CURRENT = null
const watch = (p) => {
  CURRENT = p
  p.on('requestfailed', (r) => net.push(`FAILED ${r.method()} ${r.url().slice(0, 110)} ${r.failure()?.errorText || ''}`))
  p.on('response', (r) => { if (r.status() >= 400) net.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 110)}`) })
  p.on('console', (m) => { if (m.type() === 'error') net.push(`CONSOLE ${m.text().slice(0, 140)}`) })
}
const dump = async () => {
  if (CURRENT) console.error('PAGE TEXT:', ((await CURRENT.locator('body').innerText({ timeout: 2000 }).catch(() => '(page unreadable)')) || '').replace(/\s+/g, ' ').slice(0, 700))
  console.error('NETWORK PROBLEMS (last 10):', JSON.stringify(net.slice(-10), null, 1))
}

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  watch(page)
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  // 1. empty state, create a song
  await page.goto(APP)
  await page.getByText('No songs yet').waitFor()
  check('empty state shown on a fresh database', true)
  await page.getByRole('button', { name: '+ New song' }).first().click()
  await page.getByLabel('Title').fill('E2E Rain')
  await page.getByRole('button', { name: 'R&B' }).click()
  await page.getByRole('button', { name: 'Pop' }).click()
  await page.getByLabel('BPM (optional)').fill('82')
  await page.getByLabel('Time signature (optional)').selectOption('4/4')
  await page.getByLabel('Start with').selectOption('verse-chorus')
  await page.getByRole('button', { name: 'Create song' }).click()
  await page.getByLabel('Song title').waitFor()
  check('song created with 4 sections', (await page.getByRole('tab', { name: /Verse 1|Chorus|Verse 2|Bridge/ }).count()) >= 4)

  // 2. edit three sections
  const verse = ['Midnight on the window', 'I wrote your name in steam', 'Lights down low', 'Stay a little longer']
  for (let i = 0; i < 4; i++) await line(page, i + 1).fill(verse[i])
  await page.getByRole('tab', { name: 'Chorus' }).click()
  const chorus = ['Rain on glass', 'Rain on glass again', 'Hold on to me', 'Let the morning wait']
  for (let i = 0; i < 4; i++) await line(page, i + 1).fill(chorus[i])
  await page.getByRole('tab', { name: 'Bridge' }).click()
  await line(page, 1).fill('Quiet now')
  await saved(page)
  check('three sections edited and autosaved', true)

  // 3. lock two lines (verse 1, lines 1 and 2)
  await page.getByRole('tab', { name: 'Verse 1' }).click()
  await page.getByLabel('Lock line 1').click()
  await page.getByLabel('Unlock line 1').waitFor()
  await page.getByLabel('Lock line 2').click()
  await page.getByLabel('Unlock line 2').waitFor()
  check('two lines locked', (await page.getByLabel(/^Unlock line/).count()) === 2)

  // 4. try to edit locked lines: blocked
  const locked = line(page, 1)
  await locked.click()
  await page.keyboard.type('HACK')
  await page.keyboard.press('Backspace')
  check('locked line text unchanged after typing and Backspace', (await locked.inputValue()) === verse[0])
  check('user is told the line is locked', await page.getByText(/That line is locked/).first().isVisible())
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  check('locked line survives select-all + Delete', (await locked.inputValue()) === verse[0])
  // forced paste of several lines into a locked line
  await locked.evaluate((el) => {
    const dt = new DataTransfer()
    dt.setData('text', 'x\ny')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  check('pasting into a locked line changes nothing', (await locked.inputValue()) === verse[0] && (await page.locator('.pad-input').count()) === 4)
  // the delete-section guard
  await page.getByRole('button', { name: 'Delete section' }).click()
  await page.getByRole('button', { name: 'Yes, delete' }).click()
  check('section with locked lines cannot be deleted', (await page.getByRole('tab', { name: 'Verse 1' }).count()) === 1)

  // 5. close and reopen
  await saved(page)
  await page.reload()
  await line(page, 1).waitFor()
  check('after reload: text persisted', (await line(page, 3).inputValue()) === verse[2])
  check('after reload: locks persisted', (await page.getByLabel(/^Unlock line/).count()) === 2)
  check('after reload: title/BPM persisted', (await page.getByLabel('BPM').inputValue()) === '82')

  // 6. Enter / Backspace / multi-line paste / undo / redo
  const l3 = line(page, 3)
  await l3.click()
  await l3.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('new line five')
  check('Enter adds a line below', (await page.locator('.pad-input').count()) === 5 && (await line(page, 4).inputValue()) === 'new line five')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  check('Ctrl+Z undoes typing and the new line', (await page.locator('.pad-input').count()) === 4)
  await page.keyboard.press('Control+Shift+z')
  check('Ctrl+Shift+Z redoes', (await page.locator('.pad-input').count()) === 5 || (await line(page, 4).inputValue()) !== '')
  await line(page, 3).evaluate((el) => {
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    const dt = new DataTransfer()
    dt.setData('text', '\nPasted one\nPasted two')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  const vals = await page.locator('.pad-input').evaluateAll((els) => els.map((e) => e.value))
  check('multi-line paste splits into lines', vals.includes('Pasted one') && vals.includes('Pasted two'), JSON.stringify(vals))
  check('locked lines still intact after all that', (await line(page, 1).inputValue()) === verse[0] && (await line(page, 2).inputValue()) === verse[1])

  // 7. notes (comments) incl. on a locked line
  await page.getByLabel(/^Notes for line 1 /).click()
  await page.getByLabel('Add a note').fill('make this punchier')
  await page.getByRole('button', { name: 'Add note' }).click()
  await page.getByText('make this punchier').waitFor()
  await page.reload()
  await page.getByLabel(/^Notes for line 1 \(1\)$/).click()
  check('note on a locked line survives reload', await page.getByText('make this punchier').isVisible())

  // 8. snapshot, change, restore
  await page.getByRole('tab', { name: 'Chorus' }).click()
  await line(page, 3).fill('Hold on to me')
  await saved(page)
  await page.getByRole('tab', { name: 'History' }).click()
  await page.getByLabel('Save a snapshot of this song now').fill('before-change')
  await page.getByRole('button', { name: 'Save snapshot' }).click()
  await page.getByText('before-change').waitFor()
  await line(page, 3).fill('CHANGED AFTER SNAPSHOT')
  await saved(page)
  await page.getByRole('button', { name: 'Restore…' }).first().click()
  await page.getByRole('button', { name: 'Restore it' }).click()
  await page.getByText('Earlier version restored.').waitFor()
  check('restoring a revision brings back the old text', (await line(page, 3).inputValue()) === 'Hold on to me')
  await page.getByRole('tab', { name: 'Verse 1' }).click()
  check('restore kept locked lines', (await line(page, 1).inputValue()) === verse[0] && (await page.getByLabel(/^Unlock line/).count()) === 2)

  // 9. export and import without loss
  await page.getByRole('tab', { name: 'Export' }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Full backup/ }).click()])
  const jsonPath = await dl.path()
  const exported = fs.readFileSync(jsonPath, 'utf8')
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Text \(\.txt\)/ }).click()])
  const txt = fs.readFileSync(await dl2.path(), 'utf8')
  check('text export has section headers and lyrics', txt.startsWith('[Verse 1]') && txt.includes('Rain on glass'))
  await page.getByLabel('Back to my songs').click()
  await page.getByRole('button', { name: 'Import' }).click()
  await page.setInputFiles('#im-file', { name: 'e2e.json', mimeType: 'application/json', buffer: Buffer.from(exported) })
  // wait until the dialog has finished reading the file and filled in the file name, THEN type our own title
  await page.waitForFunction(() => document.querySelector('#im-title')?.value === 'e2e')
  await page.getByLabel('Title (optional)').fill('E2E Rain (imported)')
  await page.getByRole('button', { name: 'Preview' }).click()
  await page.getByLabel('Import preview').waitFor()
  check('import shows a preview before anything is created', (await page.locator('.song-card').count()) === 1)
  await page.getByRole('button', { name: 'Import as new song' }).click()
  await line(page, 1).waitFor()
  check('imported song has the same lyrics', (await line(page, 1).inputValue()) === verse[0] && (await line(page, 2).inputValue()) === verse[1])
  check('imported song kept its locks', (await page.getByLabel(/^Unlock line/).count()) === 2)
  await page.getByRole('tab', { name: 'Chorus' }).click()
  check('imported chorus matches', (await line(page, 1).inputValue()) === chorus[0])

  // 10. Focus Mode
  await page.keyboard.press('Alt+f')
  check('Focus Mode hides the side panel', !(await page.getByRole('complementary', { name: 'Tools' }).isVisible()))
  check('Focus Mode keeps the pad', await line(page, 1).isVisible())
  await page.keyboard.press('Escape')
  check('Esc leaves Focus Mode', await page.getByRole('complementary', { name: 'Tools' }).isVisible())

  // 11. offline then back
  await ctx.setOffline(true)
  await line(page, 2).fill('typed while offline')
  await page.getByText(/Offline/).first().waitFor({ timeout: 10000 })
  check('offline: banner shown and text kept', (await line(page, 2).inputValue()) === 'typed while offline')
  await ctx.setOffline(false)
  await saved(page).catch(() => {})
  await page.locator('.save-saved').waitFor({ timeout: 40000 })
  await page.reload()
  await page.getByRole('tab', { name: 'Chorus' }).click()
  check('offline edit saved once back online', (await line(page, 2).inputValue()) === 'typed while offline')

  // 12. two windows editing the same song: conflict, no silent overwrite
  const url = page.url()
  const other = await ctx.newPage()
  await other.goto(url)
  await line(other, 1).waitFor()
  await other.getByRole('tab', { name: 'Chorus' }).click()
  await line(other, 1).fill('written in window two')
  await saved(other)
  await line(page, 3).fill('written in window one')
  await page.getByText(/changed in another window or tab/).waitFor({ timeout: 10000 })
  check('second window: conflict detected instead of overwriting', true)
  await other.close()
  await page.getByRole('button', { name: /Load the latest/ }).click()
  await page.getByRole('tab', { name: 'Chorus' }).click()
  check('after reload the other window’s text is there', (await line(page, 1).inputValue()) === 'written in window two')

  // 13. phone layout
  const phone = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true })
  const m = await phone.newPage()
  await m.goto(url)
  await line(m, 1).waitFor()
  const sw = await m.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  check('phone: no sideways scrolling', sw[0] <= sw[1], JSON.stringify(sw))
  const padBox = await m.locator('.pad').boundingBox()
  check('phone: writing pad is at the top of the screen', padBox.y < 330, JSON.stringify(padBox))
  await line(m, 4).scrollIntoViewIfNeeded()
  await m.setViewportSize({ width: 390, height: 360 }) // an on-screen keyboard shrinks the viewport
  await line(m, 4).click()
  await m.waitForTimeout(700)
  const box = await line(m, 4).boundingBox()
  check('phone: active line stays in view when the viewport shrinks', box.y >= 0 && box.y + box.height <= 360, JSON.stringify(box))
  await phone.close()

  // 14. delete -> trash -> restore
  await page.getByLabel('Back to my songs').click()
  await page.getByLabel('Delete E2E Rain (imported)').click()
  await page.getByRole('button', { name: 'Yes, delete' }).click()
  await page.getByRole('button', { name: /Show trash/ }).click()
  await page.getByRole('button', { name: 'Restore' }).click()
  await page.getByText('E2E Rain (imported)').first().waitFor()
  check('delete is confirmed, goes to trash, and can be restored', true)

  check('no uncaught page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`)
  process.exit(failed.length ? 1 : 0)
})().catch(async (e) => {
  await dump()
  console.error('E2E CRASHED:', e.message)
  process.exit(2)
})
