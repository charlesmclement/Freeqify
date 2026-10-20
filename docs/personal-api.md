# Personal library API — Phase 4

Every path is relative to BASE_PATH + `api/personal/`. An active session is required
for all routes (including HEAD where generated). POST requires application/json,
exact Origin and session X-CSRF-Token. Account ownership is derived server-side;
there is no user selector or administrator bypass. Private responses are no-store.
Opaque IDs are validated; SQL is parameterized. Remote sources, URLs and filesystem
paths are not supported. Existing loopback/Host/Origin guards remain in force.

| Method/path | Request | Result |
| --- | --- | --- |
| GET summary | — | playlists summaries, favoriteIds, history generation |
| GET playlists | — | items: own playlist summaries |
| POST playlists | name (trimmed 1–100 chars) | id |
| GET playlists/:id?offset=0&limit=48 | offset 0–5000, limit 1–100 | playlist summary, ordered page and nextOffset |
| POST playlists/:id/rename | name | ok |
| POST playlists/:id/delete | empty object | ok; UI confirmation required |
| POST playlists/:id/tracks | source: local, trackId | new independent occurrence id |
| POST playlists/:id/remove | entryId | ok |
| GET playlists/:id/queue | — | full ordered compact id/source/trackId snapshot (max 5,000), no catalog lookup |
| GET favorites/queue | — | full compact favorite references in favorite order |
| POST playlists/:id/move | entryId, direction (-1 or 1), revision | adjacent move across pages; 409 stale revision |
| POST playlists/:id/bulk | tracks: 1–100 source/trackId references | atomic append, ordered independent occurrence ids |
| POST favorites/bulk | tracks: 1–100 source/trackId references | atomic idempotent favorite batch |
| POST playlists/:id/reorder | entries: complete ordered occurrence IDs, revision | ok or 409 stale revision |
| GET favorites?offset=0&limit=48 | offset 0–5000, limit 1–100 | items and nextOffset, newest favorites first |
| POST favorites | source: local, trackId, enabled boolean | idempotent add/remove; ok |
| GET history?offset=0&limit=48 | offset 0–1000, limit 1–100 | latest play per track, items and nextOffset |
| POST history | source: local, trackId, eventId, generation, listened, position | qualified event insert/progress update; ok |
| POST history/clear | empty object | incremented generation |

Summaries include id/name, count, total saved duration (seconds), first available
saved artwork ID, revision and updatedAt. Counts include unavailable occurrences;
unknown durations contribute zero. Detail items include occurrence/event ID, source,
trackId, public track metadata and available=true/false/null. False means missing;
null means the engine could not resolve availability. Snapshots are retained rather
than fabricated or deleted. History adds playedAt and saved position. Recent album
cards are derived client-side from the displayed history page.

Adding a track validates current catalog metadata. If unavailable/missing, an existing
reference owned by that user can supply a trusted snapshot; another user's snapshot
cannot be used. Unfavoriting/removing does not require an available upstream track.
Playlist changes do not edit the temporary queue. Duplicate occurrences are allowed;
favorites are unique per owner/source/track. Names may repeat and are never SQL.

History qualification uses actual forward listening in the player: min(30 seconds,
half known duration), minimum 1 second; unknown duration requires 30 seconds. Seeks,
paused time, restoration and load failures do not count. Event IDs remain stable
across retries and progress reports. An event cannot change track identity. Progress
updates preserve the first qualification timestamp; later distinct attempts get new
IDs. Generation mismatch returns 409 HISTORY_CLEARED and cannot resurrect cleared
history. Reports are authenticated browser observations, not proof against a user
manually fabricating their own requests. No cross-user or anonymous tracking exists.

Limits: 200 playlists/account, 5,000 occurrences/playlist, 5,000 favorites/account and
1,000 history attempts/account. Queue capacity is 5,000 compact references; collection playback/enqueue
reports capacity failures without partially appending. JSON body limits remain bounded.
Errors: 400 invalid input/limits/unqualified event, 401 missing/expired/disabled session,
403 CSRF/Origin, 404 missing or unowned playlist/entry, 409 conflicting reorder/cleared
history, sanitized 502 engine error or 500 persistence error. No upstream credentials
or diagnostic body is returned. Schema and backup details: architecture.md and
apps/server/src/storage/README.md. Source/media-kind fields prepare future versioned
extensions; CSV/ZIP matching, import definitions and shared-library authorization are
not implemented.

Collection pages never include all 5,000 metadata objects. The queue endpoints are
explicit compact snapshots: they preserve every occurrence and order without
checking 5,000 upstream songs. The current song is resolved as playback proceeds;
unavailable media follows the existing skip/error policy. Favorite IDs in summary
are minimal references for heart indicators. Queue page navigation resolves at most
48 visible metadata records at a time. All queue/bulk/move routes retain session,
owner and CSRF rules; bulk is an internal building block, not a checklist importer.
Bulk request bodies are capped at 64 KiB; full reorder at 512 KiB; playback state at
4 MiB. Overflow returns 400 without partial mutation. Reordering requires the whole
permutation only through the existing reorder API; interactive moves send one ID.
