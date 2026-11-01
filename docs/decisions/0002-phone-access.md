# 0002 Phone access (OPEN - owner decision needed before Phase 1B)

A phone app cannot reach a PC at home from outside the network on its own. Options:
- **A. Same Wi-Fi only** (recommended for v1; some phone features need HTTPS).
- **B. Private tunnel** (e.g. Tailscale) for access away from home.
- **C. Hosted backend** (paid; lyrics live on a server).

Audio files are imported per device; the PC library is not automatically on the phone.

## Status after Phase 1B (still OPEN)
Music files live on the computer running the backend, so they play on a phone only if the phone can reach that computer. Today the backend accepts only `http://localhost:5173` (and 127.0.0.1). To allow another device on the same Wi-Fi *later*, the owner would choose to: run the backend and Vite listening on the network (`--host 0.0.0.0`), and list the phone-facing address in `STUDIO_BARS_FRONTEND_ORIGIN` (comma-separated). That opens the app to everyone on that network (it has no sign-in), so it has deliberately NOT been enabled. Audio does not sync between devices.
