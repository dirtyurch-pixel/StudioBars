/* A stand-in for the Datamuse web service, for tests only. Never talks to the internet.
 *   node fake_datamuse.cjs [port]
 * Control it with:  GET /__mode?m=ok|down|refuse|slow   and read what was asked with  GET /__log   (reset: /__reset)
 */
const http = require('http')
const url = require('url')
const port = Number(process.argv[2] || 8765)
let mode = 'ok'
let log = []
const WORDS = {
  rel_rhy: ['made', 'shade', 'grade', 'afraid'],
  rel_nry: ['late', 'great'],
  ml: ['storm', 'drizzle', 'shower'],
  rel_trg: ['umbrella', 'cloud'],
}
http
  .createServer((req, res) => {
    const u = url.parse(req.url, true)
    if (u.pathname === '/__mode') { mode = String(u.query.m); res.end('ok'); return }
    if (u.pathname === '/__log') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(log)); return }
    if (u.pathname === '/__reset') { log = []; res.end('ok'); return }
    log.push({ path: req.url, headers: Object.keys(req.headers).map((h) => h.toLowerCase()) })
    if (mode === 'down') { req.socket.destroy(); return }
    if (mode === 'refuse') { res.statusCode = 403; res.end('key required'); return }
    const respond = () => {
      const key = Object.keys(WORDS).find((k) => k in u.query)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify((WORDS[key] || []).map((w, i) => ({ word: w, score: 1000 - i }))))
    }
    mode === 'slow' ? setTimeout(respond, 6000) : respond()
  })
  .listen(port, '127.0.0.1', () => console.log('fake datamuse on', port))
