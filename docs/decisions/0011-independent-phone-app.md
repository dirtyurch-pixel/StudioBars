# 0011: Independent phone app (step 1 of 4)

Status: step 1 built; awaiting owner review.

The owner wants a phone app that works on its own and syncs with the PC later. Earlier work made the phone a window onto
a server; that was the wrong default and is corrected here.

## How it works
- The same React app is built in "phone mode" (`VITE_LOCAL=1`). In that mode `src/api.ts` sends song calls to
  `src/local/localApi.ts` instead of a server, and every other call fails politely ("not in the phone version yet").
- Songs, notes, locks and history are stored in the browser's own database (IndexedDB) **on the device**. Nothing is sent
  anywhere. Saves are serialised with Web Locks so two open tabs cannot mix changes.
- The rules are the PC rules, ported from `backend/app/service.py`: locked lines can never change or disappear, a save
  from a stale copy is refused (409), restores will not overwrite locked lines, imports always create a new song,
  automatic snapshots at most every 5 minutes.
- Text/Markdown/JSON import and export are a line-for-line port of `backend/app/textio.py`, so files move between the
  PC and phone versions unchanged.
- **Back up all songs / Restore a backup** on the songs page (one JSON file). Restoring adds songs as new; it never
  overwrites. The app asks the browser to keep its data (`navigator.storage.persist()`); browsers may still refuse.
- Published by `.github/workflows/pages.yml` to `https://dirtyurch-pixel.github.io/StudioBars/` (needs Pages turned on).

## Step 1 includes
Songs list, new song, writing pad, sections, locked lines, notes, undo/redo, autosave, history and restore,
import (txt/md/json), export, backup/restore, works offline, installable to the home screen.

## Not yet (later steps)
2. Rhymes, syllables and word meanings offline (ship the CMU dictionary and WordNet to the device).
3. AI helper (direct from the phone with the owner's key), Craft and Melody tabs.
4. Syncing with the PC version (today: move songs with export/backup files).
Music player, vocal recording and the PC-only server features are not in the phone version.
