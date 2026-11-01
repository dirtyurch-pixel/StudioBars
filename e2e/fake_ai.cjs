/* A local stand-in for the Claude API, so browser tests never touch the internet or spend money.
   GET /__mode?m=ok|bad|down|refuse   GET /__log   GET /__reset */
const http = require('http')
const port = Number(process.argv[2] || 8766)
let mode = 'ok'
let log = []
const answer = JSON.stringify({
  suggestions: [
    { text: 'Streetlights hum a lullaby for the lost', reason: 'sets a mood' },
    { text: 'Midnight keeps the secrets that I toss', reason: 'rhymes' },
    { text: 'I count the rain like it owes me change', reason: 'twist' },
  ],
})
http
  .createServer((req, res) => {
    const send = (code, obj) => {
      const data = JSON.stringify(obj)
      res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) })
      res.end(data)
    }
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/__mode') { mode = url.searchParams.get('m') || 'ok'; return send(200, { mode }) }
    if (url.pathname === '/__reset') { log = []; mode = 'ok'; return send(200, {}) }
    if (url.pathname === '/__log') return send(200, log)
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      let body = {}
      try { body = JSON.parse(raw || '{}') } catch {}
      log.push({ path: url.pathname, auth: req.headers.authorization || req.headers['x-api-key'] || '', body })
      if (mode === 'down') return send(503, { type: 'error', error: { type: 'api_error', message: 'down' } })
      const text = mode === 'bad' ? 'Sorry, I cannot help with that, but here is a poem.' : mode === 'refuse' ? '' : answer
      send(200, {
        id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model,
        content: [{ type: 'text', text }],
        stop_reason: mode === 'refuse' ? 'refusal' : 'end_turn', stop_sequence: null,
        usage: { input_tokens: 420, output_tokens: 90 },
      })
    })
  })
  .listen(port, '127.0.0.1')
