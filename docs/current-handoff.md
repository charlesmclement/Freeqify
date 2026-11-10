# Current implementation handoff — November 10, 2026

Music and audiobook text live under the visualizer Mode → Lyrics selector.
Both support immersive presentation. The optional Keep screen awake checkbox
releases its browser screen wake lock on hiding/exit and reacquires on return;
unsupported/denied requests have explicit status messages.

Music uses optional free LRCLIB. Server audiobook recognition uses an existing
local Whisper environment/model and requires `AUDIOBOOKS_TRANSCRIPTS_ENABLED=true`.
It defaults off independently of the existing spoken-heading reader. Hosts should
choose this explicitly according to their resource policy and measured capacity.
Disabled requests perform no audio decoding or recognition. No paid recognition
API, automatic model download or original-media modification is introduced.

Additive migration 14 stores owner-private, source-qualified timed text in a
bounded cache with existing quota accounting and book/account deletion. One speech
worker is shared with spoken headings, with six uncached windows/minute/user,
90-second recognition deadline, bounded audio/response sizes and cancellation.
Recognition uses 30-second windows and one following prefetch. Minor timestamp
boundary noise and trailing decoder padding are tolerated; starts remain inside
the actual passage and malformed or uncertain speech is omitted.

Back navigation uses compact left arrows. Library Back, Scan and Refresh share a
row, excess page spacing is reduced, and album download matches the palette beside
Queue album. Disabled buttons are dark. Home's large visualizer is scoped to its
overview and no longer pushes album/artist details below the fold.

## Planned device processing and playback continuity

Phone-local Whisper is the preferred future native-client direction. Server-side
recognition should remain available for capable self-hosted machines. The intended
architecture preserves the existing UI and one background-capable playback owner,
with local models, device text caching and owner-private synchronization of playback
progress, queues and generated transcript text. Another device can then resume and
reuse recognized text regardless of where recognition ran. Phone-local recognition,
client transcript uploads and a native app are NOT implemented in this release.

Android testing would use signed APK releases, with Google Play distribution and
managed updates considered later. Preserve authentication/CSRF protections; do not
weaken Host/Origin checks to accommodate a native wrapper. Original audio remains
read only, and upstream credentials remain on the server.

Next confirmed request: order Audiobooks by actual most-recent listening activity,
newest first, with stable pagination and existing filters. The same ordering for
music is a tentative idea requiring view/scope definition. Neither ordering change
is part of the current implementation.

## Validation and limits

Automated validation covers owner isolation, ordinary administrator denial,
CSRF/input validation, timing/confidence filtering, caching/deletion, revocation,
mode changes, line seeking, offline/disabled/error states and wake-lock lifecycle.
Root and prefixed browser checks use generated media and actual local Whisper,
including immersive 320/390/740/1280 layouts, one audio owner and private paths.
Main-page checks cover all thirteen application destinations.

Recognition may lag playback and contain text/timing errors. Some deep positions
in MP3 files without a usable seek index exceed the bounded reader's 48 MiB source
budget and fail explicitly. Do not silently increase budgets or promise complete
coverage. Native/device decoding should address long-file access separately.
Physical-device and actual OS wake-lock acceptance remain installation-specific.

Migration 14 is additive. Back up persistent data before upgrading and preserve it
outside the checkout. An older schema-13 binary cannot open a schema-14 database;
retain a paired pre-upgrade backup and never overwrite newer listener progress
with a stale backup as an automatic rollback.
