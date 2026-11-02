# 0012: Phone ↔ PC sync, the design decided now and built later

Status: design agreed, not built. It's step 6 of the reliability phase, prompted by an outside review that
said: decide identities and conflict rules now; build the transport later.

## Goals
- One writer, two or more devices (phone app, PC version), each working fully offline.
- Never silently lose writing. When unsure, keep both versions and let the writer choose.
- Locked lines stay locked everywhere.
- Simple enough for one developer to build, test and explain.

## What we already have that sync needs
- **Stable random ids** for every song, section, line, revision, take, vault item, recording, track and
  playlist. The same id means the same thing on every device. The complete backup (decision 0011) already moves
  records between devices with their ids, so restore with "Add what's missing" is a manual, one-way sync today.
- **Song versions**: every save increments `version` and refuses a stale base version (`VERSION_CONFLICT`).
  That is the base-revision information sync needs.
- **Content hashes** for audio (SHA-256 in the backup; the PC also hashes music files), so media can be sent
  once and deduplicated.

## What sync will add (in this order)
1. **Device id**: a random id per device, saved once.
2. **Outbox**: each local change also writes one small "change" record in the same transaction as the edit
   (`Store.batch()` already makes this possible). Fields: operation id (random), record kind and id, base
   version, new version, time, device id. An edit and its outbox entry are stored together or not at all.
3. **Tombstones**: deleting a record writes a tombstone (kind, id, time) instead of only removing it. Tombstones
   are kept until every known device has acknowledged them. Songs already soft-delete (`deleted_at`); other kinds
   need this.
4. **Transport**: devices exchange outbox entries.
   - Option A: the PC is the hub. The phone syncs when it can reach the PC (home Wi-Fi or Tailscale, https only).
     It's free and private, but it only works when the PC is on and reachable.
   - Option B: a small relay holding encrypted change records, so phone and PC sync without being online at the
     same time. It costs money and needs an account, and the lyrics would pass through it, though encrypted.
   - Decision deferred to the owner. Start with A, keeping the protocol the same so B can be added.
5. **Acknowledgements**: the receiver records which operation ids it has applied, so a retry can never apply a
   change twice. The sender keeps an outbox entry until it is acknowledged.
6. **Media**: sent separately, by content hash, only if the other side doesn't already have it.

## Conflict rules (version 1)
- **Same song edited on both devices since the last sync**: keep **both**. The incoming version is saved as a copy
  named "<title> (from phone)" or "(from PC)". The writer sees "Phone version / PC version" and a side-by-side
  comparison, and chooses. **The latest timestamp never decides silently.**
- **A line locked on one device and edited on the other**: the lock wins. The edit is preserved as an alternative
  take on that line (Craft → Takes), never dropped.
- **Deleted on one device, edited on the other**: the edit wins, and the song is restored from the trash with a
  note.
- **Non-song records** (vault, phrases, pronunciations, playlists): the last change wins per record, because
  these are small and independent. Deletions use tombstones.
- Later, and only once the above is proven: automatically merge edits to *different lines* of the same song.
- **No CRDT.** Whole-song conflict copies are much easier to build, test and explain.

## Out of scope for version 1
- Sharing with other people or collaborating in real time.
- Syncing the AI key, which never leaves a device.

## Tests that must exist before sync ships
- Edits on both devices while offline lead to both versions being kept, with nothing lost.
- A retry after a dropped connection leads to no duplicate change.
- A lock on the phone against an edit on the PC leads to the lock being kept and the edit saved as a take.
- A delete against an edit leads to the edit being kept.
- Run on two real devices, not only in the test browser.
