# 0002 Phone access (OPEN - owner decision needed before Phase 1B)

A phone app cannot reach a PC at home from outside the network on its own. Options:
- **A. Same Wi-Fi only** (recommended for v1; some phone features need HTTPS).
- **B. Private tunnel** (e.g. Tailscale) for access away from home.
- **C. Hosted backend** (paid; lyrics live on a server).

Audio files are imported per device; the PC library is not automatically on the phone.

## Status after Phase 1B (still OPEN)
Music files live on the computer running the backend, so they play on a phone only if the phone can reach that computer. Today the backend accepts only `http://localhost:5173` (and 127.0.0.1). To allow another device on the same Wi-Fi *later*, the owner would choose to: run the backend and Vite listening on the network (`--host 0.0.0.0`), and list the phone-facing address in `STUDIO_BARS_FRONTEND_ORIGIN` (comma-separated). That opens the app to everyone on that network (it has no sign-in), so it has deliberately NOT been enabled. Audio does not sync between devices.

## Update: phone / tablet mode built (option A, same Wi-Fi), owner asked for it
- `scripts/serve.sh` (Windows: `scripts/serve.ps1`, not yet run on Windows) builds the app and serves it plus the API from ONE address on the network, e.g. `http://192.168.1.20:8000`.
- A **PIN is mandatory** (6+ characters, `STUDIO_BARS_ACCESS_PIN`); the script refuses to start without one. Every `/api` call needs the sign-in cookie (HTTP-only, keyed hash, never the PIN); wrong guesses are rate-limited. `/health` and the app's own files stay open.
- The app is **installable** (manifest, icons, offline app shell). Service workers and full "Install app" need HTTPS; plain `http://` on a home network gives a browser shortcut instead. For HTTPS from anywhere, use a private tunnel such as Tailscale (option B) in front of it.
- Not covered: the traffic is not encrypted on plain Wi-Fi (PIN and lyrics visible to someone sniffing that network); no per-user accounts; audio stays on the host computer and plays on the phone by streaming from it.
