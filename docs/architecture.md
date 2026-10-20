# Architecture — Phase 4

## Runtime and boundaries

Browser → one loopback Fastify entry point → server-only Subsonic adapter →
loopback Navidrome → read-only original music.

- React/TypeScript/Vite remains in `apps/web`; Fastify/TypeScript in `apps/server`;
  public DTOs in `packages/shared`. No service credentials or configuration types
  are exported through shared code.
- Development uses Vite middleware/HMR on the same server. Production builds serve
  only WEB_DIST_DIR. Existing missing-asset/API handling and prefix validation remain.
- Freeqify never reads audio files. The supported Navidrome Subsonic 1.16.1 API owns
  catalog IDs, indexing, and its separate SQLite database. No internal Navidrome
  APIs are used by the adapter. Freeqify's own account SQLite database is independent from Navidrome.
- All assets and metadata requests are same-origin. No cloud service, external
  font, metadata provider, analytics, or internet access is required at runtime.

## Approved visual identity

Phase 0's dark forest-green/near-black palette, lime accents, typography, spacing,
sidebar, vinyl record, `f.` branding, and minimalist design remain approved.
`App.tsx` keeps the landing hero and original layout. `Library.tsx` adds overview,
artists, albums, track metadata, and search below it. Sidebar and library tabs share
navigation state; compact mobile views use library tabs. Additional styles extend
the original stylesheet. Substantial redesign requires explicit approval.

## API and adapter

All paths below are relative to `BASE_PATH + api/library/` and are GET-only:

| Freeqify route | Supported upstream endpoint / behavior |
| --- | --- |
| connection | ping |
| overview | getArtists, paged getAlbumList2, getScanStatus |
| artists | getArtists |
| artists/:id | getArtist with albums |
| albums | getAlbumList2, alphabeticalByName |
| albums/:id | getAlbum with tracks |
| tracks | search3 with documented OpenSubsonic empty-query enumeration |
| tracks/:id | getSong |
| search?q= | search3, artist/album/song results |
| artwork/:id | getCoverArt, fixed size 400 |

The adapter accepts an injected fetch implementation for mocked tests and exposes
no general-purpose URL/endpoint method. JSON fields are runtime-validated and
mapped to explicit DTOs. Unknown names, absent duration, and missing artwork have
fallbacks. Invalid IDs/shapes fail safely. Stable opaque string IDs come directly
from Navidrome; they are never interpreted as filesystem paths.

Album/track/search pages default to 48 and accept at most 100 items and bounded
offsets. Artists use the complete documented getArtists response. Overview counts
artists and paginated albums and uses the engine's scan count for tracks. It caches
for 15 seconds and coalesces concurrent requests; a 500,000-album guard fails rather
than claiming a truncated total. Track totals reflect the configured service user's
local engine scan; All catalog routes now require an active Freeqify account. Invited listeners are
authorized members of the same installation-wide music collection; all see the
same aggregate catalog counts. Account/profile/session/invitation data is separate.
Future per-user data must use a user_id foreign key and enforce ownership; per-user
Navidrome credentials are not required.

Upstream requests use POST form parameters with a fresh cryptographic salt and
Subsonic `t=MD5(password + salt)`, `s`, `u`, `v`, `c`, and `f`. MD5 is required by this
protocol; it is not used for Freeqify password storage. HTTP is restricted to
loopback here. Credential-bearing query strings and plaintext password parameters
are not used. Redirects are refused, request/body timeouts are bounded, and bodies
are capped at 8 MiB JSON / 5 MiB artwork. Only JPEG/PNG/WebP/GIF responses may be
returned as artwork; SVG, arbitrary upstream headers, and external redirects are
not forwarded. Library responses use no-store. The separate Phase 3 stream route is described below; explicit device downloads now use the separate catalog-ID route described in the current offline extension below.

## Local-only networking retained through Phase 3

Startup rejects non-loopback HOST values. Requests require a loopback socket peer,
a loopback Host header, no cross-site Fetch Metadata, and a matching Origin host
when provided. This applies before Vite middleware as well as to catalog routes.
Forwarded headers are not trusted. There is no unrestricted CORS. A public proxy
that deliberately rewrites all requests as localhost would undermine this boundary;
operators must not expose this phase. These guards are retained alongside invitation-only authentication, session
security, CSRF defenses, persisted rate limits, and role/ownership checks.
Authentication does not authorize public deployment.

Adapter URLs must be loopback HTTP(S), with no URL credentials/query/fragment;
localhost is normalized to a literal address. A service username and random password
are server-only. Prefer an owner-only password file outside the repository; unsafe
permissions fail startup. Public errors contain only fixed messages/codes. Raw
fetch errors and upstream error messages are discarded. Fastify request logging
omits URLs/queries. Frontend bundles contain no service credentials. Production
retains CSP, nosniff, frame denial, and no-referrer headers.

## Configuration and original-file protection

Process environment wins over an external private config file, which wins over the
optional repository `.env`. Both Vite tooling and server startup use this order.
`FREEQIFY_CONFIG_FILE` overrides the XDG/home default config path. Relative directories
resolve from the source root; all host-specific values stay outside source. Prefixes
are compiled into frontend requests and must match runtime BASE_PATH.

Navidrome binaries, config, persistent data/cache, Freeqify source, and original
music are independent. The native launcher refuses data paths overlapping music or
the source checkout (including resolved symlinks). By default Bubblewrap mounts only
explicit system runtime paths, the engine binary/config and read-only music, with
private engine state/cache and `/tmp` writable. It grants no root rights, changes no
original permissions, and does not
modify tags, artwork, or audio. The private temp area is required by SQLite migrations.
On restricted hosts an explicit external read-only mount/ACL/container may replace
Bubblewrap; there is no silent unsandboxed fallback. Engine external services,
sharing, downloads, and externalized auth are disabled by the launcher.

Native Linux is the current route. No mandatory Docker, sudo, service installation,
firewall change, or Plex modification is introduced. Host-specific deployments,
public HTTPS proxies, optional Docker packaging,
public deployment, playlists, radio, podcasts, and discovery are outside
this phase. Playback is implemented in Phase 3 below. Private account persistence is implemented below.

## Account database and migrations

`auth/store.ts` uses Node 24's built-in SQLite interface, avoiding native npm addons
or system SQLite build dependencies. `storage/migrations.ts` defines append-only,
transactional migrations and SQLite user_version; a newer schema refuses downgrade.
Users have stable UUIDs, normalized unique usernames, password hashes, role, status,
and creation timestamps. Invitations and sessions reference users with foreign keys.
This prepares future per-user tables without implementing playlists or other phases.

`DATA_DIR` defaults to private XDG/home storage outside the checkout. Startup resolves
symlinks and rejects source/web-root overlaps and configured music overlaps. Existing
data directories must already have the right owner and 0700 mode; files must be
private, regular, and owned by the process user. WAL and foreign-key enforcement are
enabled, with a busy timeout. Never reset or delete persistent data during upgrades.
Back up the entire directory with the service stopped, preserving owner and modes.

The authorized local owner creates the initial administrator through `admin:create`
after building. The CLI requires a TTY, hides both password prompts, rejects password
arguments/non-interactive execution, and refuses subsequent bootstrap attempts. The
last check and insert are atomic across processes. There is no HTTP admin-setup route.

## Authentication and authorization

- Passwords: async scrypt N=32768, r=8, p=3, random 128-bit salt, 64-byte key and
  constant-time comparison. The encoded hash records its algorithm/parameters.
  Passphrases require 15–128 characters; oversized inputs are bounded. At most two
  password derivations run at once per process. Unknown users still run scrypt;
  invalid/unknown/disabled logins receive the same public error.
- Invitations: random 256-bit bearer tokens; only SHA-256 hashes stored. Administrator
  supplies an expiry between one minute and 30 days. Tokens are returned once,
  carried in a URL fragment, removed from the address by the frontend, and sent in
  POST bodies. Validation repeats inside the single-use acceptance transaction after
  password hashing, protecting against concurrent reuse, revocation, and expiration.
  Every invitation creates a listener, regardless of any client-supplied role.
- Sessions: random 256-bit opaque cookie token; only its hash stored. Anonymous
  bootstrap sessions last at most 20 minutes for login CSRF protection. Successful
  login/registration replaces that session and rotates the cookie. User sessions have
  configurable absolute/idle expiry, capped active-session count, and survive restart.
  Requests check current account status/role in SQLite. Disabling a listener revokes
  all sessions atomically; session-only revocation is also supported.
- CSRF: SHA-256 domain-separated derivation from the random session token is returned
  only through same-origin JSON. Every mutation requires that token in a custom
  header and the exact expected Origin (HTTPS when Secure cookies are configured).
  SameSite=Lax is defense in depth. Cookies are HttpOnly, no Domain attribute, scoped
  to BASE_PATH, and Secure by production default. Forwarded protocol/IP are not trusted.
- Throttling: SQLite-backed windows for login IP and normalized account/IP, invitation
  checks/acceptance, and anonymous-session creation. Scrypt concurrency is also bounded.
  No password, invitation, or session bearer value is logged or stored in plaintext.

The central guard uses canonical registered route templates, not raw URL spelling.
Library routes also enforce authentication within their own plugin, including artwork
and HEAD requests. Admin routes require administrator role; store methods recheck it.
Only GET health, session bootstrap, and the CSRF-protected login/invitation entry points
are public to local visitors. No public signup, role elevation, or administrator
creation endpoint exists. The self-profile endpoint returns only the current user's
record. Other users' accounts are visible only to administrators; Navidrome's service
account remains server-only and separate from all Freeqify credentials.

The existing App shell/hero/sidebar/CSS are extended with login/invitation registration,
a profile menu/logout, and administrator invitations/listeners. Private library
components mount only after session validation and unmount after logout/401. Passwords
and invitation links are held transiently in memory, not localStorage. Account UI
responses are no-store. Public source assets contain no catalog rows or credentials.

## Account API

All paths include BASE_PATH + `api/`. All POSTs require JSON, Origin, and CSRF.

| Route | Authorization / behavior |
| --- | --- |
| GET auth/session | Anonymous bootstrap or current session; returns CSRF + safe self DTO |
| GET auth/me | Active user; self only |
| POST auth/login | Anonymous/session CSRF; rotate on successful login |
| POST auth/password | Active session, current password, new policy, CSRF/rate limits; revoke all own sessions |
| POST auth/logout | Session CSRF; revoke current session and clear cookie |
| POST auth/invitation | Anonymous/session CSRF; validate invitation without private inviter details |
| POST auth/accept-invitation | Anonymous CSRF + valid invitation; create listener and session |
| GET/POST admin/invitations | Administrator; list status/create token once |
| POST admin/invitations/:id/revoke | Administrator; revoke unused invitation |
| GET admin/users | Administrator; safe account fields only |
| POST admin/users/:id/disable | Administrator; disable listener and revoke all sessions |
| POST admin/users/:id/revoke-sessions | Administrator; revoke target sessions |

Admin/self disabling, role promotion, MFA, public proxy trust and actual production
deployment remain unimplemented. Phase 5B adds authenticated password change and
local-only administrator recovery below. Keep this phase local-only.

## Sources and validation

- [Node 24 SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Navidrome supported Subsonic API](https://www.navidrome.org/docs/developers/subsonic-api/)
- [Subsonic authentication and endpoints](https://www.subsonic.org/pages/api.jsp)
- [OpenSubsonic search3](https://opensubsonic.netlify.app/docs/endpoints/search3/)
- [Navidrome configuration](https://www.navidrome.org/docs/usage/configuration/options/)

Mocked tests cover successful/failed connections, catalog/format metadata, malformed
responses, missing/available artwork, search, bounded parameters, credential protection,
local access, and preserved Phase 0 behavior. Optional live smoke checks enumerate
real local data. See Phase 2 report for results and limitations.

## Phase 3 media and playback

`media-routes.ts` registers GET/HEAD `api/library/stream/:id` under the existing
canonical library guard. `Navidrome.stream` uses the supported Subsonic `stream`
endpoint with `raw` or `mp3`, fresh salted credentials in POST bodies, and redirects
disabled. A bounded metadata lookup verifies existence first. The stream route
allowlists audio MIME types, selected numeric/range headers and statuses, sanitizes
failures and never passes upstream cookies, location or error bodies to clients.
Single bounded byte ranges pass upstream. HEAD opens the same supported upstream
POST but cancels its body after headers. Cold transcodes can return 200 with no
range support; cached ones may return 206. No byte-range semantics are fabricated.
Node Readable.fromWeb and Fastify preserve backpressure, and downstream closure
aborts the fetch; a preClose hook cancels active responses before graceful shutdown
waits for them. The connection/header timeout uses NAVIDROME_TIMEOUT_MS; there is
no total-song timeout. Every active response checks the session without extending
idle expiry each second, and closes when authorization disappears. The client
checks GET `api/playback/status` every 15 seconds without touching idle expiry, so
buffered playback also stops after an invalid session is detected. Browser-buffered
bytes cannot be revoked retroactively. Absolute expiry remains authoritative.

`Player.tsx` owns one declarative HTMLAudioElement per signed-in user; it sits above
view changes and survives catalog/admin navigation. `playback-queue.ts` contains
independent queue transitions. Catalog DTOs remain unchanged. Queue references use
local source + stable track ID + unique occurrence key; future source namespaces
need separate authorization/adapters. No remote source is accepted now.

Playback restores through GET `api/playback`; POST to the same route requires
JSON/exact Origin/session CSRF. Additive migration 2 adds playback_state with a
user_id primary/foreign key, bounded validated JSON and update timestamp. It never
alters migration 1 or existing accounts. Queue limit is 5,000; progress saves every
15 seconds, structural/settings changes debounce 800 ms, hidden-page saves are
best effort. Each user sees only their row. Multiple tabs use last-write-wins.
The browser retains an account-qualified recovery draft of unacknowledged queue references/settings; reload restores paused. The
player unmounts and releases media on logout/401. Changes do not create playlists
or listening-history tables. Existing private storage and backup rules still apply.

MP3/WAV use original audio first; a non-MP3 failure or explicit compatibility
selection requests on-demand MP3 at 320 kbps through Navidrome/FFmpeg. Navidrome's
own externally located cache owns derived files, never originals. Transcoded seek
is disabled conservatively, including cached transcodes; native seek requires
browser seekable ranges. No timeOffset extension is assumed. Failed entries are
skipped with a queue-bounded retry set to avoid infinite failure cycles.

PWA foundations consist of a relative-scope manifest and 192/512 px mask-safe
vinyl/f. icons. No service worker is registered and nothing caches private media or
account responses. BASE_PATH is built into links, media requests and manifest URL;
manifest-relative URLs retain the prefix. Media Session integration is optional.
HTTPS installation, remote proxy trust, Android store packaging and offline music
remain future authorized deployment/features, not implied by these foundations.

Protocol references: [OpenSubsonic stream](https://opensubsonic.netlify.app/docs/endpoints/stream/)
and [Navidrome supported API](https://www.navidrome.org/docs/developers/subsonic-api/).

## Phase 4 personal collections

`personal-store.ts` owns SQLite operations for permanent personal data, separate from
Navidrome and the temporary listening queue. Every operation verifies an active
account; playlist lookups/mutations use both owner ID and playlist ID, without admin
bypass. `personal-routes.ts` adds canonical protected `/api/personal/*` APIs with a
second plugin guard and exact Origin/session CSRF for mutations. Public metadata is
resolved through the supported catalog adapter with four bounded workers and
request-local duplicate coalescing. Missing IDs return saved snapshots with
available=false; engine failure gives available=null. No original media is touched.
Only the owner can copy existing missing references using trusted saved snapshots.

Additive migration 3 creates personal_playlists, personal_entries,
personal_favorites, personal_history and personal_settings. Playlists have stable
UUIDs/revisions and user ownership. Occurrences have distinct IDs, source/track IDs,
media_kind, saved metadata and a unique playlist/position pair. Reorder validates a
complete occurrence permutation and expected revision inside BEGIN IMMEDIATE, using
a temporary negative-position phase to avoid uniqueness conflicts. Concurrent edits yield 409 for stale
reorders. Favorites use a composite owner/source/track primary key. History uses an
owner/event primary key, source-qualified references, progress and timestamps, with
owner/recent/track indexes. Generation checks make clear-history resistant to delayed
writes. Existing migrations, accounts and playback rows remain intact.

`PersonalContext.tsx` lives above Playback for the signed-in user, owns summary/hearts
and an accessible Add to Playlist native dialog, and clears on account change/logout.
`TrackActions.tsx` extends catalog and player surfaces. `PersonalViews.tsx` integrates
with existing sidebar/tabs; it adds no second navigation system or player. Collection
playback snapshots compact ordered references into the existing queue, preserving
duplicates/order; missing streams are skipped by the existing playback error handler. Queue operations remain in
playback-queue.ts. Collection edits never alter an active queue. Limits are
5,000 queue references, 5,000 occurrences per playlist, 5,000 favorites per user and
200 playlists per user. Metadata and UI rows are paged independently from references.

`listening.ts` measures elapsed forward playback and rejects seeks/paused samples.
`useListeningHistory.ts` associates one random event with a listening attempt across
rerenders/navigation. Qualification is min(30s, half duration), with minimum 1s, or
30s for unknown duration; server validates the threshold against catalog metadata.
Reports are authenticated client observations, not an independent proof of listening.
Qualified progress updates are throttled to 15 listened seconds; stable event IDs
make retries idempotent. Saved positions are independent of Phase 3 playback state.
At most 1,000 attempts per user are kept; history displays latest event per track,
paged 48/max 100. Recent albums are derived from the current page. A clear increments
the user's generation and blocks the current attempt from refilling history.

See personal-api.md for endpoint contracts and storage/README.md for migrations.
No checklist importer, family sharing, remote source, audio importer, Meme Mode,
service worker/offline cache or deployment is added. Future extensions can build on
owner/source/media-kind references and stable occurrence IDs through migrations.

### Phase 4 capacity and bounded loading

Migration 4 adds personal_entries_track(track_id,playlist_id) and the covering
favorite page index(user_id,created_at DESC,track_id). Existing ordered unique
(playlist_id,position) index serves playlist LIMIT/OFFSET pages and adjacent moves.
Details default to 48 metadata rows, max 100; offset is bounded at 5,000. Favorites
counts and existence checks query indexed scalar rows, never full metadata arrays.
Summary hearts contain IDs only. Playlist detail computes aggregates only for the
requested playlist. Full reorders use Set membership and two-phase negative positions
inside a transaction, avoiding collisions above 1,000. Adjacent moves use three
indexed updates and a revision check; moving across pages preserves global order.

Collection queue endpoints return at most 5,000 ordered {id,source,trackId} records
without upstream lookups. This compact snapshot is necessary for shuffle, repeat,
independent queue edits and paused restoration; full metadata is not loaded. Player
metadata fetches are limited to current/visible 48 queue entries, deduplicated with
four workers and pruned on resolution. Only 48 upcoming rows plus the current song mount at a time.
Playback validation uses Sets for linear checks. The playback POST alone accepts
4 MiB (bounded worst-case 256-character IDs); full reorder accepts 512 KiB and bulk
reference routes 64 KiB. Other routes retain existing small request limits. Queue
persistence retains its throttle, with compact snapshots saved per existing policy.

Atomic bulk append/favorite routes accept up to 100 validated references. Metadata
resolution deduplicates within the batch and uses four workers; a capacity failure
rolls back the whole batch. Playlist occurrences retain duplicates, favorites are
idempotent. Batches touch/count once and reuse prepared insert statements; future
checklist matching can submit consecutive batches without implementing imports now.

## Phase 5B security boundaries

Production generic static-file serving is replaced by `public-assets.ts`: strict
build-output allowlist, descriptor-relative no-follow traversal of every directory
component and opened regular file, resolved-path checks, bounded reads and an
immutable memory snapshot. The Vite closeBundle gate rejects unapproved output.
Runtime requests never reopen assets. Approved root files are index.html, PWA
manifest/icons and app.js; assets/ permits named fingerprinted JS/CSS/PNG/SVG/WOFF2.
Do not broaden this to user-uploaded content or private backups.

`resources.ts` supplies fail-fast admission (queue length zero); stream/transcode
slots release on end/error/disconnect/HEAD/shutdown and retain existing revocation
checks/backpressure. Catalog/personal and large playback requests have admission before body buffering;
logout is exempt from the general rate budget while keeping CSRF checks; all adapter calls
share a global budget and 30-second operation deadline propagated to Navidrome fetch
through AsyncLocalStorage. A timed-out non-cooperative operation retains its slot
until it truly settles. Existing upstream response time/size caps remain. Requests
also have a persisted per-account one-minute rate window; body/socket timeouts are
30 seconds, not a total-song deadline. Normal long streams have no song-length cap.

Migration 5 adds personal_usage and accounting triggers to existing tables. Logical
UTF-8 content plus conservative per-row overhead is tracked transactionally for
playlists, entries, favorites, history and playback. Quota checks run before commit
and rollback bulk writes atomically. Existing over-quota data is preserved, with
reducing changes allowed. Defaults: 256 MiB/account, 2 GiB aggregate, 16 KiB/track,
4 GiB SQLite main file and 256 MiB available-disk reserve. WAL retention is configured
but not a hard filesystem quota; physical indexes, pinned WAL/temp/backups and
Navidrome caches still need host monitoring/quotas. Existing databases larger than
configured max are retained at their current page count, not truncated. Do not run
old releases against schema 5 or restore a backup casually to downgrade.

Password policy affects new credentials only; legacy scrypt verification is unchanged.
Change-password verifies current password, derives a fresh salt/hash and atomically
compares the original credential and active session before replacement/revocation.
Concurrent recovery/change cannot overwrite a newer hash. Local recovery requires
TTY, data-owner privileges and explicit confirmation; there is no HTTP recovery.

Shared private-file loading in scripts/private-files.mjs uses no-follow descriptor
walks, trusted non-writable parent ownership, owner-only regular files and bounded
reads. The native engine uses a minimal env and narrowly mounted filesystem, private
PID/IPC/UTS namespaces, read-only system/music and writable state/tmp. Host networking
is shared for the loopback service; it is not a firewall. Dedicated service UIDs and
host process/resource restrictions are still required. Freeqify itself has no music
path API and needs no direct media filesystem access. No system identity/configuration
was created by Phase 5B. See the remediation report for remaining deployment gates.


## Phase 5C prepared installation and proxy contract

The earlier local-only descriptions remain the default. Explicit production-only
proxy mode adds one exact PUBLIC_ORIGIN, one trusted literal loopback socket peer,
validated single-IP X-Forwarded-For and https protocol; alternative forwarding formats,
foreign Host/Origin and remote backend peers fail closed. Fastify trustProxy stays
disabled. Validated client identity drives existing persisted rate limits. Auth and
personal mutations use the configured exact origin plus session CSRF. HTTPS cookies,
no-store, prefix, streaming and all owner rules remain. Development proxy mode is
rejected. A trusted local peer can assert client identity: this is a single trusted
proxy model, not authentication between hostile local processes. Never expose the
engine or proxy a development server.

scripts/setup.mjs writes private review drafts only. scripts/installation.mjs owns
path/overlap/permission/port validation, descriptor-relative exclusive secret writes
and separate systemd template rendering. It never starts indexing, provisions UIDs,
installs units or changes music. engine.env is separate from server.env; Freeqify
receives no music directory in its configuration. Music selection metadata is a
versioned array for future expansion; only one selected root is supported today.
The final identity must repeat access checks before scanning.

scripts/maintenance.mjs snapshots private state/config directories using SQLite backup
for detected SQLite files, streaming SHA-256 integrity manifests and exclusive new
output directories. Stopped-writer confirmation is required for coherent application/
engine/config snapshots across files. Restore makes a new copy and revokes Freeqify
sessions/invitations; no live overwrite or database downgrade is automated. Operator
must back up each UID's state/config and installation metadata separately. No audio
is copied. Updates/rollback/uninstall are deliberate reviewed procedures; data is
retained by default. No schema change is added by Phase 5C.

Generated systemd units protect system/home/kernel, restrict privileges and writable
paths, bound CPU/memory/tasks/FDs and request localhost-only IP access. They require
host validation (including cgroup/BPF support), separate OS identities, immutable
releases and private file permissions. Actual installation, real engine helpers,
storage quotas/cache/log sizing, TLS and Plex coexistence remain host gates.
See linux-installation.md and omen-deployment-beginners.md. No internet readiness claim.


Phase 5C final review adds an exact source transfer allowlist/packer (no Git publication,
private config/data/music/dependencies/builds), explicit fresh/migrate setup choice,
and optional owner-only reference-baseline capture/check across restored copies.
The OMEN plan is fresh installation; no laptop account or engine-state migration is
required. Optional native engine/path/post-scan migration remains a separate gate;
no automatic ID rewriting or live replacement occurs.

The native launcher requires MUSIC_READINESS_FILE. Read-only findmnt UUID/target/
type/fsroot and an existing-file sample identify the confirmed collection, including
an internal directory on a containing filesystem. Missing/empty mount directories
fail before state creation/spawn. No marker, mount/fstab or music writes are introduced.
Scheduled/watch scans are disabled, startup scan is explicit (fresh true/migrate false),
and missing-file purge is never. Readiness-checked restarts gate approved rescans;
this does not lock hardware or provide a hot-unplug interlock. Actual host verification
is still required. See both installation guides.

## Album artwork resolution

Authenticated same-origin album artwork routes first apply administrator-selected
shared covers, then preserve explicit per-account choices, then probe Navidrome album and track cover IDs before considering online images.
Navidrome `dc-*` disc artwork is excluded from album resolution by user preference.
The read-only scanner review bridge accepts only a unique normalized artist/title
match, a scanner-derived SHA-256 filename and validated JPEG/PNG/WebP bytes within
3 MiB. It never follows report paths into music directories. `ARTWORK_REVIEW_DIR`
configures the server-side review directory; `MUSICBRAINZ_CONTACT` enables optional
strict online lookup with existing bounded requests, allowlisted redirects and rate
limits. Migration 7 adds account/album-ID online cover storage with metadata checks
and personal storage accounting, and replaces removed genre preset choices with
neutral vinyl. Local artwork still wins over persisted online images. Automatic
fallback rows never prevent a genuine image from being used; failed lookups are
not persisted as permanent misses. Image responses remain no-store and mounted
images reload on application focus or artwork-choice changes.

Migration 11 adds `shared_album_artwork`, an additive catalog-level override that
neither reads nor rewrites personal choices, collections, history, queues or music.
Shared covers are limited to 5,000 albums and 100 MiB of image bytes; each raster
image is capped at 3 MiB. SQLite's configured database limit and free-space check
also apply. Removing a shared cover restores prior per-account resolution.

Inside the authenticated artwork plugin, administrators may GET `artwork/album/:id/shared`
for status; POST `.../cover-search` with bounded artist/album fields; GET
`.../cover-preview/:token`; and POST `.../shared` with a server-issued token to select,
or `{mode:"remove"}` to remove the shared cover. All mutations require Origin/CSRF/JSON.
Active administrator status is checked again after remote I/O. Search is optional,
using the existing `MUSICBRAINZ_CONTACT`; it does not relax strict automatic matching.
Interactive results may be ambiguous: only an explicit administrator selection saves
an image. All remote hosts remain fixed/allowlisted; no URL or filesystem parameter
is accepted. Metadata remains bounded at 256 KiB, with 8-second per-attempt timeouts,
MusicBrainz pacing and raster MIME/signature checks inherited from the existing client.

Search admits two concurrent provider operations globally and one per administrator,
with one search per administrator per five seconds. At most six candidates are returned.
Opaque previews are account/album-bound, expire after five minutes, and occupy a
24-entry cache (at most 72 MiB image payload). Images are fetched only when previewed
or selected, with in-flight deduplication. Expired or evicted previews require another
search; failed images are not saved. Responses are no-store, same-origin and private.
Existing request admission applies in production as well. Other clients refresh on
focus/reload; this feature introduces no live broadcast or private service-worker cache.

## Responsive mobile presentation

The same authenticated React tree serves mobile and desktop. Bottom navigation
changes existing library views; More reuses account and administrator components.
The approved desktop sidebar, foundation, and palette remain intact. Home reads
library overview, at most six history entries, existing personal summary data,
and eight newest albums; album and artist views render bounded pages of 48.
The album-list query accepts only `alphabeticalByName`, `alphabeticalByArtist`,
or `newest` through the optional `sort` parameter. These map to supported
Subsonic `getAlbumList2` types; all existing authentication, input validation,
network boundaries, admission limits, and no-store headers remain in force.

The player owns one audio element outside the changing views. Its mini-player
opens Now Playing as a nonmodal main-pane view, with the persistent bottom tray
remaining available over the visualizer. Explicit immersive mode uses native modal
focus containment. Escape first collapses an open queue, then exits immersive mode
or dismisses Now Playing. Body scrolling is locked only for immersive mode. Opening or closing the view does not
change the media source. Mobile safe-area padding reserves room for bottom
navigation and the current mini-player; reduced-motion preferences are honored.

The existing manifest continues to use relative start/scope/icon URLs for prefix
compatibility. `viewport-fit=cover` enables safe-area handling. No service worker,
private caching, offline audio, fictional lyrics, or simulated visualization was
introduced. Browser installability and background audio still depend on the
host/browser and approved access configuration.

## Audio spectrum visualization

`Player` retains its single HTML audio element and lazily mounts a persistent
Now Playing dialog. `audio-spectrum.ts` keeps one Web Audio graph per element in
a WeakMap, sharing pending initialization to prevent duplicate source creation.
The source connects directly to the destination at unity gain; an optional
analyser side branch never enters the audible path. Closing/disabling the scene
disconnects only that branch. Player disposal closes the graph. Initialization
resumes the context before rerouting media; same-origin checks run first.

`SpectrumScene` uses WebGL 2 instanced cubes, perspective, face lighting, mirrored
reflections, a floor grid, and a restrained additive glow pass. Explicit matching
shader integer precision is required for linking on Chromium. A 4096-point FFT
feeds logarithmic 35 Hz–16 kHz groups with faster attack and slower decay. Two
rear rows follow delayed measured levels. No simulated/random audio is used.
Seven palettes include Amber CRT. Preferences use account-qualified localStorage.

Animation stays outside React state. Drawing stops while closed/hidden/disabled;
paused music freezes levels and permits only a bounded palette transition. Normal
rendering is capped at 45 fps on desktop and 30 fps on compact stages, DPR 1.5
and a 2.4-million-pixel drawing buffer; device reduced motion uses a lower frame rate, DPR 1, fewer
instances, and no reflections/glow. Reduced motion uses 8 fps. Context-loss
listeners permit restoration; real unmount disposes GPU resources and releases
the context, while StrictMode's simulated cleanup does not lose a mounted canvas.
Mobile CSS uses viewport-sized grids and expandable settings without replacing
existing playback, favorite, playlist or queue actions. No server/API/schema or
credential changes are needed for this feature.

The listening room redesign keeps the same scene and audio element across normal
and immersive layouts. A roughly 68% desktop stage accompanies a compact listening
panel; mobile and landscape compositions preserve reachable controls. Immersive
chrome hides after inactivity during playback, remains visible for focused
controls/open settings/queue, and returns on pointer, touch or keyboard activity.
Escape exits immersive mode before closing the native modal. ResizeObserver adapts
the canvas and mobile geometry; IntersectionObserver also suspends off-screen draws.
Soft spectral contrast preserves silence and quiet passages rather than normalizing
them into loud signals. Smoothed measured bass, midrange and treble energies drive
floor illumination and emission; no synthetic beat animation or microphone input
is used. The 3D camera flies varied gentle arcs while playing, except with device reduced motion.
All visualizer canvases use native vertical scrolling, without camera pointer capture
or wheel/pinch interception. The full chart remains in the main content flow.
Existing rendering caps remain in place. Saved palettes and explicit visualizer opt-outs are retained;
new listeners default to visualization enabled. See redesign validation.

## Tools: private playlist-import checklists

The explicitly requested playlist importer extends the existing authenticated
server with `/api/imports/` under BASE_PATH. JSON carries bounded CSV text; there
is no multipart dependency, archive extraction, filesystem-path argument, external
image fetch, Spotify login or Spotify API call. The strict CSV parser accepts
quoted fields, escaped quotes, UTF-8 BOM, CRLF and embedded newlines, validates
metadata and preserves row order/duplicates. Imported artwork URLs are not kept.

Additive migration 8 adds owner-scoped checklists, ordered entry payloads and
short-lived album reviews. Usage triggers include all new metadata in existing
per-owner/global storage budgets. Existing passwords, sessions, media references
and personal collection tables remain intact. Match IDs/metadata come from the
bounded Navidrome adapter, never from caller-supplied playable snapshots. Optional
ISRC is a public recording identifier. Exact normalized title/artist and album or
ISRC plus duration qualify only a unique candidate; variants and ambiguous matches
require explicit confirmation. Manual decisions/rejections persist. Outages do not
become Missing. Last-check results refresh in bounded rotating batches while the
Tools view is visible and on explicit recheck. Recheck is serialized per owner/list;
all new endpoints share existing admission, active-session, CSRF and no-store rules.

Playable playlists are created atomically through PersonalStore, preserve duplicates
and order, and remain independent of the checklist and player queue. Linked creation
is idempotent; subsequent playlist edits are never silently overwritten. Availability
snapshots must have been checked in the preceding five minutes before creation.

The optional loopback-only Lidarr adapter uses a private key file, fixed API paths,
redirect refusal, ten-second request timeouts and bounded responses. Credentials and
raw Lidarr resources/paths remain server-side. Read-only lookup presents exact album
name candidates without silently selecting an artist/edition. Owner-bound reviews
expire after ten minutes. Administrator-only confirmation checks choices against the
stored review and serializes external submissions. It records Requested only after
GET confirms monitoring. Failures can leave a partially completed review; retry
rechecks remote state and does not duplicate monitored albums/searches. Automatic
search is an explicit OFF-by-default choice and targets only confirmed album IDs.
Existing artist settings are reused unchanged. New artists require an explicitly
selected existing root-folder ID; its default profiles/tags are reused, new-item
monitoring and broad automatic searches are disabled. No existing Lidarr root,
profile, downloader, Transmission or seeding settings are edited.

UI navigation adds a wrench Tools destination. Mobile navigation uses accessible
icon-only controls and retains the same persistent mini-player. Review workflows
use native modal sheets, separate from the primary checklist. No other tool is
represented as functional. No deployment is implied by this local implementation.


### Administrator library scans

`POST /api/library/scan` requires an active administrator, exact same-origin request,
valid session CSRF token, and an empty JSON object. One scan request per minute is
allowed across administrators. It checks the engine's current scan status and joins
an ongoing scan instead of starting another. `GET /api/library/scan` is also admin-only.
The server uses the supported Subsonic `startScan` and `getScanStatus` endpoints with
existing server-side credentials and catalog admission/time budgets. No scan paths,
commands or upstream URLs are accepted. The UI polls every five seconds while visible,
stops polling on unmount or after five minutes, and rechecks the selected private
checklist once scanning completes. Requested is not a download-completion signal.

While an administrator keeps Playlist Import visible, bounded automatic rechecks detect
files imported by Lidarr and trigger library indexing when needed (at most once per ten
minutes, sharing the manual scanner's global one-minute limit). Newly matched tracks
become Available and a ready-to-play notice appears. This is browser-visible automation;
Freeqify does not add a background acquisition daemon or change Navidrome's scheduler.


If the normal Navidrome account cannot start scans, configure the optional paired
`NAVIDROME_SCAN_USERNAME` and `NAVIDROME_SCAN_PASSWORD_FILE` settings with an existing
authorized scanner identity. Those credentials are used only for `startScan`; ordinary
catalog, scan-status and streaming requests retain the normal restricted service account.
No password is exposed to the browser or accepted in a request body. Do not promote or
reset an existing account merely to enable scanning.


## Persistent playlist acquisition queues

Migration 9 adds owner-bound `import_album_queues`, cascading with its checklist and
account and included in existing personal storage quotas. One queue per checklist
stores at most 5,000 selected entry IDs grouped by normalized album/artist. No
credentials, filesystem paths or remote URLs are stored in the queue or sent to
the browser. Public queue snapshots expose counts, up to ten ready album groups
and ten failures; they never expose another owner's queue, including to admins.

Queue endpoints require current active administrator sessions; mutations retain
same-origin/CSRF protection and per-checklist locking. Each step performs at most
one album lookup or one explicitly confirmed submission, serialized with legacy
Lidarr submissions. Reviews retain server-resolved candidates; confirmations
validate candidate IDs, permissions and current checklist statuses. Remote monitoring
is verified before Requested is recorded. Persisted receipts deduplicate albums
across batches; Lidarr's existing already-monitored behavior prevents repeated
searches after uncertain outcomes/restarts. Search defaults off for each review.

The optional manual dialog drives bounded step requests until ten albums need review
or no lookup/submission work remains. Manual processing stops after the current
step when closed. The legacy short-lived ten-album review API remains compatible;
the UI no longer limits total selection to ten albums or fifty tracks.

Migration 10 adds automatic/paused flags and a server-only authorizing session hash.
The administrator-only, CSRF-protected Seek all action is explicit bulk consent to
request and search unique exact title/artist album matches. It includes all checked
missing entries, merging an earlier partial queue without discarding receipts.
Multiple candidate IDs, wrong artists, missing matches and setup-required results
stay in review, and do not block other pending albums. Before lookup, a bounded
live-catalog check can match selected recordings already present locally and avoid
an unnecessary acquisition. Existing recording IDs and duplicate local candidates
retain the ordinary match/review rules.

One in-process worker processes at most one album lookup/submission per one-second
scheduling turn, round-robin across active queues, sharing checklist locks and the
global Lidarr submission guard with manual endpoints. It runs independently of the
browser and resumes persisted work after restart. Every external await boundary
rechecks the grant: owner must remain an active administrator and its initiating
session must exist and remain unexpired. Worker activity never refreshes session
idle expiry. Sign-out/session revocation/expiry pauses further work; Seek all can
reauthorize with a fresh valid session. No raw bearer token or new background
credential is stored or exposed. Pause takes effect across an in-flight await;
already completed upstream effects cannot be undone and remain safely retryable.
Failure pauses the automatic job. Shutdown stops scheduling and drains the current
bounded upstream step before closing account storage. Public queue polling updates
status without causing acquisitions; browser closure does not pause automatic jobs.

### Progressive player buffers

Playback uses a single authenticated fetch per successful song download. `song-buffer.ts` validates MIME/status, enforces 64 MiB per song even without Content-Length, rejects truncated bodies, retries transient failures three times with a 30-second inactivity timeout, and cancels/revokes discarded entries. At most current + next payloads are retained; chunk assembly, MediaSource buffers and decoding can temporarily consume additional memory.

`progressive-audio.ts` appends MPEG bytes sequentially to a MediaSource SourceBuffer and signals playback readiness after half a second is available, or at EOF for shorter songs. If playback underruns, it pauses until three seconds are buffered (or EOF), then resumes the same source if playback is still wanted. Downloading continues through EOF without swapping the active source. An unprepared non-MP3 song uses the existing on-demand MP3 compatibility stream when MPEG MediaSource is supported. Already prepared originals retain their format. Next-song prefetch requests the original once current playback has eight seconds of headroom, or after current completion. This prioritizes startup before allowing the second download to compete for bandwidth. Unsupported browsers/formats, parser failures and quota limits fall back to a complete blob, preserving playback position on recovery. Interrupted fetches retire the progressive consumer so retry bytes cannot be appended twice; available decoded audio may continue while the full download retries. Insufficient buffered audio can still stall. Network errors never automatically skip a queue entry.

Server streaming remains bounded and no-store; only media-src permits blob URLs. No service worker, persistent audio, external service or filesystem conversion is involved. Logout/session rejection/queue clearing revokes temporary URLs and cancels work. The existing 15-second session-status/known absolute-expiry checks remain; unreachable servers cannot retract previously delivered bytes. Browser suspension can delay playback/checks.

### Dual visualization engines

`MusicVisualizer` retains the existing spectrum scene and camera while switching the
stage to a lazily imported Butterchurn 2.6.7 engine. MilkDrop connects an analysis-only
branch through `connectAudio` to the existing `audio-spectrum` graph's source and context;
it never creates another media source or destination connection. Leaving MilkDrop disconnects
its branch and retires its dedicated WebGL context (Butterchurn 2.x has no public dispose API).
Spectrum rendering stops in MilkDrop mode. MilkDrop rendering stops while paused, hidden
or off screen; resize/preset changes allow a static paused frame. Resolution is bounded
at 1280×900 and device pixel ratio 1.5, with a 60 FPS target or 15 FPS with device reduced motion.

Eight presets from butterchurn-presets 2.4.7 are shipped as static functions, generated
by `node scripts/prepare-milkdrop.mjs` from the installed dependency. This avoids runtime
preset compilation and preserves the production CSP without `unsafe-eval`. Their names
and code are generated together; add further trusted presets in that script. Both packages
use MIT licensing; notices are retained in `apps/web/src/milkdrop/` and the web build.
No remote presets or image URLs are accepted. Automatic cycling is opt-in, every 30 seconds,
and suspended with hidden/inactive/paused visualization and system reduced motion.
Existing per-user localStorage settings gain validated engine, preset and cycle fields;
older settings retain all existing spectrum values. There are no new environment variables,
API routes, migrations or deployment changes.

### Administrator catalog removals

Migration 12 adds `library_removals` and `library_removed_members` with local-source
qualified identifiers. All earlier migration SQL is unchanged. Records live in the
existing private account SQLite database, independently of personal collections.
Album membership snapshots support active-stream revocation; an album rule also
covers newly indexed songs with that album ID. Removing/restore operations accept
only a validated track/album ID, kind and explicit confirmation. They require an
active administrator, exact Origin, CSRF, JSON, bounded bodies and mutation rates;
permissions are rechecked after upstream lookup and within the write transaction.
Metadata is derived from the configured catalog, never supplied by the browser.

`removableLibrary` sits inside the existing catalog admission/deadline wrapper
and is shared by browsing, search, artwork, import matching, personal availability
and media. Physical Navidrome content remains untouched. Filtered pages retain
upstream cursors, including empty pages; filtered search adds an optional explicit
nextOffset so its next page remains reachable. A versioned 15-second metadata cache
adjusts counts/empty albums/artists from the affected upstream records. Mutations
invalidate it immediately; requests without removals bypass this projection.
Upstream failures fail closed. Raw scanning counts remain physical indexed counts.

There are at most 10,000 rules and 100,000 snapshot memberships, with at most 10,000
members per album operation and bounded metadata text. Writes are transactional,
parameterized and subject to the database limit and existing free-space guard.
Restore works without contacting Navidrome and permits removal of records even
under low-space conditions. No personal collection or queue is rewritten, and
administrator access grants no access to another owner's saved collections.

New streams check removals; active responses use the existing one-second revocation
check to stop removed known IDs. Already buffered bytes cannot be recalled. Open
clients refresh/revisit to update their rendered lists; no cross-client push or
private cache is introduced. Exclusions follow Navidrome IDs, so replacing the
catalog with new identities requires reviewing removals. No filesystem path,
upstream write API, deployment change or environment setting is introduced.

## Installable shell and navigation

The existing account-keyed persistent Playback tree surrounds hash-based screen
navigation. A single external route store batches related changes into browser
history, restores Back/Forward and refresh state, and traverses existing ancestors
when closing panels. Public route state contains only presentation identifiers;
transient add-to-playlist/import-review payloads stay in bounded session memory.
No route state grants access or replaces API validation.

A build-generated, prefix-scoped service worker caches an exact public shell and
hashed JS/CSS allowlist. API/auth/artwork/audio, Range requests and mutations bypass
it. No private runtime caching, skipWaiting, clients.claim or forced reload. New
workers wait for old windows to close; activation cleans only this installation's
old shell caches. Manifest identity and scope stay relative to its hosting path.
Details and future storage constraints: PWA report.

Production proxy mode distinguishes public top-level app entry from protected
requests: only GET/HEAD document navigation to the exact base/index shell can
arrive with cross-site Fetch Metadata. Socket/Host/forwarding/HTTPS/Origin checks
remain mandatory. APIs/media/embeds/writes receive no exception; local mode stays
strict. Denials are no-store and responses vary on policy headers. See
installed-app launch diagnosis and evidence.

Library-change refreshes retain route selection and offset. The phone dock's
seek-row expansion is local presentation state; it does not change playback,
progressive buffering, queue snapshots or Web Audio connections. Full Now Playing
and desktop seek controls keep their existing behavior.

### Session continuity and angular UI

The web account client remembers identities from session responses. After an explicit
CSRF_REJECTED response, it refreshes the session and retries at most once if the CSRF
changed and the known account identity is unchanged. Cross-account writes and generic
403s are never replayed. The account provider receives refreshed session state without
unmounting the persistent player. Media 403s do not imply session expiry; 401s do.
Bounded denial diagnostics include categorical CSRF context without secrets or URLs.

Shared CSS uses square corners, wrapping centered button labels, mobile 44px minimum
button targets and 16px text inputs to avoid focus zoom. At the user’s request, the viewport disables browser page zoom where honored;
OS magnification and browser accessibility overrides remain outside app control. Existing visualizer canvas gestures and fullscreen behavior
are preserved; touch-action manipulation applies to ordinary interactive controls.

Library category tabs stack non-wrapping labels beneath their icons. Dashboard
count cards use container-relative typography and the formatted count length for
all categories, preserving the complete accessible label. Song-row actions occupy
44px square grid cells; narrow phones use two columns. Historically, Download was an inactive
placeholder with no pseudo-element label or backend behavior.


## Temporary manual queue and context

Playback snapshots retain the existing private SQLite table and add optional
`origin: "manual"` on occurrences and `contextLabel` on state. Old snapshots remain
valid without a migration. Pending manual occurrences precede context songs and
survive context replacement; earlier occurrences remain available when saving the
current queue. Shuffle only reorders upcoming context. QueueTray mounts at most
48 upcoming rows plus the current song and keeps its scroll independent of the
persistent player. Pointer capture supports touch/mouse section-local reordering;
keyboard and button alternatives use the same transitions.

Account-qualified localStorage recovery drafts hold unacknowledged public queue
references/settings only. They restore paused and clear on matching server save,
logout or revocation. Structural saves are debounced and single-flight; failed
saves retry when online. No audio, credentials, catalog cache or offline auth is
added. Concurrent clients still use last-write-wins server snapshots.

`POST /api/personal/playlists/from-queue` requires an active owner session and CSRF,
accepts up to 5,000 ordered references (duplicates allowed), resolves trusted
metadata with four workers and bounded admission/deadline, then rechecks session
and creates the playlist in one transaction. Resolution failures create no partial
playlist. This is separate from the temporary queue and never alters original audio.
Downloads and offline audio are implemented by the current extension below.


The compact queue is an animated grid row inside the existing player immediately
after seek, with a bounded independent scroller and fixed bottom navigation. It
retains its mounted contents while collapsed to animate without a height jump;
only current/48 upcoming rows are rendered and metadata fetching remains bounded.
Queue rows use 46px spacing, 34px artwork, right-aligned duration and the existing
ActionMenu for reorder/remove operations. Private collection playback opens the
queue automatically. See `docs/compact-queue-report.md`.


`PlaybackSurface.tsx` registers a stable main-pane portal host. Normal Now Playing
uses a nonmodal dialog within that host and leaves the dock/navigation available;
only explicit immersive mode uses the modal top layer/body scroll lock. It shares
the same audio element and visualizer instance. Tray pointer handling is limited
to its grip/track header/queue heading and requires a 40px predominantly vertical
movement. It excludes seeking, transport, visualizer interaction and queue rows.
See `docs/swipe-main-pane-report.md`.


Home renders the visualizer through the same main-pane portal when Now Playing is
closed, ensuring a single analyser/visualizer owner. `spectrum-2d.ts` draws real FFT
levels using Canvas 2D and mirrors all seven existing shader palette formulas.
`spectrum2d` is the default engine; browser settings version 2 preserves explicit
later mode choices and existing palette settings. Spectrum analysis attaches on
playback or explicit enabling, with the same visibility/pause limits. Queue Earlier
mounts/fetches at most 16 past entries only on request, independent of listening
history. Library scan/refresh and account-action changes only affect layout.
See `docs/home-spectrum-report.md`.

Home visualizer controls sit below the chart. Hold the chart for 650ms to turn it off;
tap the disabled chart to enable it. Expand/Shrink labels remain on one line. The full chart accepts native page scrolling; the previous right scroll lane and arrows
have been removed. 3D camera gestures are disabled. During playback, the 3D view flies varied slow arcs with gentle changes in height and distance; pause and device reduced motion stop the sweep. Choose 2D for a lightweight visualizer. See
`docs/visualizer-touch-report.md`.

## Explicit offline MP3 library (current extension)

This extension supersedes historical statements above that downloads/offline audio
are deferred. It preserves the approved UI and the streaming player. There are no
server schema migrations or server-side download records.

`download-routes.ts` adds authenticated `GET api/library/download/:id`, sharing
existing stream/transcode admission budgets. It accepts only a validated catalog
ID; no URL, filesystem path, range, format, or encoder option is accepted. The
route checks active-session revocation/removal during a transfer, aborts upstream
and its own encoder on disconnect/shutdown, and uses a 30-second inactivity bound.
It requests only original (`raw`) Navidrome audio. MP3 is passed through; other
supported audio flows through FFmpeg stdin/stdout, using `libmp3lame` with a 320 kbps
target, selected public ID3 tags and a pipe-only input protocol whitelist. No audio
file, conversion cache, or archive is written on the server. CPU concurrency shares
MAX_TRANSCODES with normal compatibility streams. `DOWNLOAD_FFMPEG_PATH` is an
administrator-controlled executable path/name, never a client parameter. Existing
playback's Navidrome compatibility behavior and existing cache are unchanged.

`offline-store.ts` owns a prefix/account-scoped IndexedDB database (version 1):
tracks with source-qualified origins, ordered collection snapshots, and 1 MiB audio
Blob chunks with SHA-256 digests. Chunk index/count/size/hash verification precedes
completion; exports verify again. Incomplete data is never selected for playback.
A source discriminator leaves room for future device recordings without routing
them through the library downloader. No recorder is implemented.

IndexedDB was chosen over OPFS for one portable transactional store, including
metadata/reference updates and Blob storage. Both are origin-private, quota-bound
browser data; OPFS would not itself provide a user-visible music folder. The
File System Access picker is not required because its availability varies across
mobile browsers. An explicit verified Blob download link provides ordinary-file
export without a companion. See [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system),
[storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria),
and [persistent storage requests](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).

`offline-downloads.ts` queues one foreground transfer per prefix/account across
tabs through Web Locks. Selections are durable before transfers start. Download
creation validates the server identity; private routes retain their existing
same-origin/active-account policy. Each unfinished track restarts from zero after
interruption: transcoded MP3 streams do not provide safe stable byte-resume ranges.
Completed files are reused. Cancellation releases incomplete chunk storage; partial
or missing tracks remain visible for explicit retry. A playlist is paginated with
revision checks before saving its ordered snapshot. Reference garbage collection
preserves tracks still owned by another album, playlist or individual selection.

`OfflineContext.tsx`, `DownloadButton.tsx`, `OfflineView.tsx`, and `local-artwork.tsx`
connect the device store to compact existing controls. The public worker still
intercepts only exact public assets/root shell navigation; APIs, audio, byte ranges,
mutations and arbitrary paths bypass it. Shell fallback now also handles server
error responses. Private audio is never added to Cache Storage. CSP permits Blob
images for saved artwork and existing Blob audio, without permitting Blob scripts.

Authentication distinguishes **device-only access** from a verified server session.
Only the last verified public account profile is remembered; no CSRF/session token,
password/hash or upstream URL is saved with media. Network failure may open that
account's local library with listener-only presentation and empty server authority.
Offline mode blocks server-management/library views, collection writes, queue sync
and listening-history writes. Confirmed server sign-out/disablement clears remembered
access; files remain intact. Offline logout records a pending server logout, then
clears device access. Connectivity recovery verifies a real session before restoring
online UI; local playback need not stop. Local storage is unencrypted trusted-device
data, not DRM or a substitute for server authorization. Remote revocation cannot be
learned while disconnected; exported files remain under the user's control.

`SongBuffer` consults a completed local Blob resolver before its existing network
path. Local files use the same current/next Blob lifecycle, player and queue; they
are independent of the temporary network buffer limit. The original bounded
progressive streaming, cancellation, range protection and on-demand compatibility
behavior remain for tracks without downloads. Playback never creates a download
selection. Offline progress is kept only in the existing local queue draft, with
paused restoration and no retrospective listening-history upload.

Future recorder requirement from the user: while actively recording, request a
Screen Wake Lock where available; release it on stop and report revocation or
unsupported/background restrictions. This downloader does not record audio or
keep the screen awake for ordinary playback/downloads.

The device queue uses a state index rather than scanning every saved track per
transfer. Saved artwork is reused across album tracks; unchanged metadata/Blob
handles are retained between cross-tab polls. The offline view renders 48 tracks
per page while whole-selection playback still populates the existing 5,000-track
queue. Cancelling all downloads also invalidates selections whose playlist
metadata is still loading, so they cannot start a new batch after cancellation.

The user reports that their phone's native screen recorder can capture the audio
they tested. This is device-recorder evidence, not browser/PWA capture validation.
Browser capture capabilities still need separate testing for any future recorder.
The later artist-support feature is only a user-verified official merch-store
link; no scraping or product catalogue is requested or included here.

Playback-source provenance is attached to SongBuffer entries (`device`/`server`)
and shown in both player surfaces. Local resolution precedes network loading and
can replace a retained temporary server buffer when that source is prepared again.
It does not swap an attached source when a download completes. A temporary server
buffer remains usable if local lookup is unavailable during disconnection.

Queue downloads use the existing action menu and a small absolute check badge;
row geometry stays intact. Explicit full local-file removal atomically releases
that track from every local collection and deletes its chunks, after stopping any
matching transfer. Shared removal is confirmed with its selection owners. Releasing
only one reference remains available separately. Online AlbumArtwork uses live
server cover resolution; only device-only playback uses the saved cover.
