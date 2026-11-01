# Release checklist (what is and is not verified)

Verified in the Linux build container (automated, repeated on GitHub CI):
- Backend: ruff, pytest (350+ tests). Frontend: eslint, tsc, prettier, vitest (200+ tests), production build.
- Real-browser suites (Chromium): Phases 1, 1B, 2, 3, 4, 5, 6, 8 and phone/tablet mode (PIN lock, installable manifest, phone and tablet widths).
- The AI co-writer against a local stand-in for Claude. **No real Claude call has been made.**

NOT verified (needs you, on your devices):
1. Windows: `start-studio-bars.bat`, `start-studio-bars-phone.bat`, `scripts/serve.ps1`, `scripts/dev.ps1` have never been run on Windows. Windows Firewall may ask about Python.
2. Real phone and tablet: layout, touch targets, on-screen keyboard behaviour, installing to the home screen, audio playback, melody grid scrolling. Only phone-sized browser windows were tested.
3. Microphone features (vocal recorder, humming) work only on https:// or localhost. Over plain http:// on Wi-Fi they show an explanation instead.
4. Real Claude key: press "Test connection" in the AI tab.
5. Not built: Windows installer (.exe), signed app, auto-update, waveform/beat markers, voice-to-lyrics transcription, training mode, House loop editor.

Before sharing outside your home Wi-Fi: use a private tunnel with https (for example Tailscale); never expose the PIN-only server to the open internet.
