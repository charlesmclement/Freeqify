# Persistent account storage

`migrations.ts` contains append-only, versioned account migrations. `auth/store.ts`
opens private SQLite storage under DATA_DIR, outside the repository/public web root.
Users, invitations, sessions, and authentication throttles persist across upgrades.
Foreign keys reference stable user IDs for future private-data relationships.

Never reset or delete the database during updates. Back up the entire data directory
with the service stopped; preserve private ownership and modes. Original music is
never a database/data-directory location. Navidrome maintains its independent data.


## Current versions

1. users, invitations, sessions, auth_rate_limits: private accounts and session security.
2. playback_state: one validated player/queue JSON row per user.
3. personal_playlists, personal_entries, personal_favorites, personal_history,
   personal_settings: owner-private durable collections and history-generation state.
4. personal_entries_track and personal_favorites_page: capacity lookup/page indexes.

Migration 3 is additive and transactional. Playlist entries use separate UUIDs for
duplicates; unique (playlist_id,position) preserves order. Favorites are unique by
(user_id,source,track_id). History is unique by (user_id,event_id), indexed by recent
plays and track, with a per-user generation counter preventing stale writes after
clearing. Metadata is a trusted catalog snapshot, not audio, paths or credentials.
User foreign keys cascade only when an explicitly authorized account deletion is
implemented; no such account-deletion API exists today. Ordinary account disabling
preserves personal data. Playlist deletion cascades only its entries.

Limits: 200 playlists/account; 5,000 songs/playlist and 5,000 favorites/user; 1,000
history attempts/account. The queue is capped at 5,000 compact references. Reordering uses
a full permutation and revision check in a transaction. All persistence operations
check active owner status; admin role does not grant access to another user's rows.
Rescans may lose catalog references; snapshots remain, and no automatic destructive
reconciliation is performed. Future source types/import definitions need explicit
schema/API design and further migrations, not edits to these versions.

All collections, playback and account/session data share the existing private SQLite
file and its sidecars, so the documented whole-directory stopped-service backup
covers personal data too. Do not write backups under source, web roots or music.
Newer schemas refuse old code; never downgrade by deleting tables or changing
user_version. Restore a consistent appropriate-version backup with the app stopped.

Migration 4 only adds indexes for saved track lookup and stable favorite pagination.
No table is recreated and no row or queue state is discarded. Playlist pages use
existing UNIQUE(playlist_id,position); favorite pages use (user_id,created_at DESC,
track_id). Single moves swap three positions transactionally; full reorder first
negates positions to avoid uniqueness collisions at the new capacity. Bulk insert
batches reuse statements and enforce owner/playlist bounds atomically.

## Phase 5B migration 5

Adds personal_usage and transactional triggers to meter existing/new playlist names,
track snapshots, favorites, history and playback using UTF-8 bytes plus conservative
row overhead. Existing records are accounted without changing hashes or collections.
App quotas reject only growth beyond configured budgets and permit cleanup; no
automatic deletion occurs. Main-file page ceiling/free-space reserve supplement this
logical accounting, but do not replace host filesystem/WAL/cache/backup quotas.
Migration SQL versions 1–4 remain unchanged. Older releases must not open schema 5.
