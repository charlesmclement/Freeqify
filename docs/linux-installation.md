# Native Linux installation preparation

Phase 5C is preparation for review. No service has been installed. First deployment
requires separate approval. Review each command before proceeding. Keep Plex, existing Navidrome and other services
running unchanged. Do not expose this application to the internet.

## Requirements and limits

Linux with /proc, Node **24** including node:sqlite, npm **11+**, FFmpeg, Bubblewrap
and tar. systemd is recommended for separate identities and resource controls.
`node scripts/doctor.mjs` inventories dependencies without reading application
configuration, starting services or installing packages. Missing dependencies require
a separately reviewed package-manager action. User namespaces and nested systemd /
Bubblewrap operation must work on the target; never fall back to an unsandboxed engine.

The default downloaded engine remains Navidrome 0.64.2. Review official
[releases](https://github.com/navidrome/navidrome/releases) and
[security advisories](https://github.com/navidrome/navidrome/security/advisories)
before installing; 0.64.1 fixed five upstream vulnerabilities and 0.64.2 includes
further fixes. Engine and OS package security is independent of npm audit.
Node24's [SQLite backup API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
is used for consistent snapshots. Availability does not certify the host.

Shared hosting is **unverified**. Rootless operation is possible under a constrained user
supervisor, but shared same-UID code has access to that UID's secrets. A host lacking
separate isolation, read-only media, user namespaces, compatible Node24 and private
state is unsuitable. Docker is optional future work, not a prerequisite.

## Layout and preparation

Choose locations after inventory, without assuming mount points or free ports:

| Purpose | Ownership/access |
| --- | --- |
| Immutable versioned release | operator-owned, runtime identities read/execute only |
| Compiled frontend | release/apps/web/dist, allowlisted public files only |
| Freeqify private configuration/password | Freeqify UID, parent 0700/files 0600 |
| Freeqify state | Freeqify UID 0700, DB and WAL/SHM 0600 |
| Engine private configuration | Navidrome UID, parent 0700/files 0600 |
| Engine state/data/cache | separate Navidrome UID, 0700 |
| Dedicated engine binary | operator-controlled, read/execute by engine |
| Backups | separate private operator-controlled storage, outside releases/music |
| Logs | journal, bounded retention approved after host inventory |
| Original music | existing location/ownership unchanged; engine read/traverse only |

Use real release directories, never a `current` symlink in WEB_DIST_DIR or secret
paths: existing no-symlink validation deliberately rejects that arrangement.
Services reference one exact versioned release. Keep prior releases for rollback.
Never place private state/config/backups inside Git, web output or music.

`npm run install:prepare` asks plain questions and writes a **new** private bundle.
Its parent must already exist with mode 0700. It does not download, build, create
accounts, install services, start scanning, chown or chmod any existing files.
It asks where your music lives; there is no ~/Music default. Absolute paths with
spaces/Unicode and mounted drives work. The selected directory may be a symlink;
the tool displays and persists the resolved target. Ancestor overlaps are rejected.
Shell/systemd expansion characters and control characters are intentionally rejected;
choose a safe reviewed mount alias rather than evaluating path text.

The permission test runs as the invoking UID. For dedicated deployment it is only
preliminary until repeated as the eventual engine UID. Do not claim the installer's
access proves a different service identity can read files. Test actual descendants,
mount readiness, symbolic links and a representative track under that identity.
Absolute symlinks outside /music intentionally fail inside the narrow sandbox.
Do not add host-root/home mounts to make them work. Prefer a reviewed exact read-only
mount or library layout; this phase makes no automatic mount/ACL changes.

Advanced noninteractive preparation: `node scripts/setup.mjs --spec /absolute/private/spec.json`.
The JSON keys are installationMode (fresh or migrate), music, confirmation (CONFIRM), output, serverState, engineState,
backups, release, node, binary, port, enginePort, basePath, serverIdentity,
engineIdentity, serverConfig, engineConfig, passwordFile. All path values are explicit
absolute paths; identities must be distinct fq- names. No credentials belong in the
specification. Never overwrite an existing bundle. Port checks are advisory because
another process can bind afterward; startup still fails rather than evicting it.

The bundle's `.env` files and `.service` files are drafts. Their final configuration
paths refer to distinct private identity-owned locations. **Do not start the units
against the staging bundle.** Install the drafts to the selected final locations as
a separately approved administrator step. Create the referenced password file with
a hidden input workflow as the Freeqify identity, not a command-line secret.
After the server build, as the Freeqify config owner in a real TTY, use
`node scripts/configure-engine-credential.mjs /REVIEW/server.env /REVIEW/NEW-server.env`.
It prompts for the existing non-admin engine username/password twice (hidden), writes
only a new exclusive private password file and a new config; install the new config
deliberately. Existing credentials are never overwritten. If a partial write fails,
retain it privately and investigate before selecting new paths. No password is generated
or guessed by preparation. Never relax the existing private-file reader.

## Dedicated identities and services — administrator review only

No real account/service creation is authorized in this phase. On the actual host,
review `getent passwd NAME` and `id NAME` first. Choose two unused names; never reuse
Plex, a human account or an existing Navidrome identity. Provision each with no login
shell, no home, no supplementary privileged groups, no sudo/Docker membership.
An approved example for ONE chosen identity is:

```sh
sudo useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin fq-CHOSEN
```

Substitute the reviewed name and verify nologin location first. This creates a real
account, so it is not a preparation command. Repeat only after reviewing the first
result. Do not delete identities during rollback until retained data ownership has
been planned. Provision each private directory individually with `install -d -m 0700
-o NAME -g NAME /REVIEW/PATH`; review each exact path and ownership before running.
Install private configuration individually with `install -m 0600 -o NAME -g NAME
/REVIEW/DRAFT /REVIEW/FINAL`. These commands need administrator approval. Never run
recursive chown/chmod on music or an arbitrary home. Access to selected music may
need a narrowly reviewed read/traverse ACL; do not prescribe broad group membership.

Generated units enforce distinct UIDs, no capabilities, no new privileges, protected
system/home/kernel, private temp/devices, read-only releases and one writable state
path. Engine also has a read-only selected music path and inner Bubblewrap mounts.
IPAddressDeny/Allow requires working cgroup/BPF support; verify enforcement, not just parsing. Loopback-only IP access does not isolate other local services by port.
ProtectHome may intentionally block media stored in a human home: stop and design
an exact read-only mount outside /home; never disable home protection broadly.
Neither identity may write release code or read the other's secrets. System runtime
/usr remains readable; verify it contains no unrelated secrets.

Initial per-service draft budgets are CPUQuota=50%, MemoryMax=1G, TasksMax=64,
LimitNOFILE=1024, 30-second shutdown and control-group termination. These are review
starting points, **not hardware-safe promises**. Inventory Plex/headroom first.
Set storage quotas/reserves separately: MemoryMax does not bound disk/cache. Monitor
engine cache and database/WAL size, journal retention and available blocks; choose
an operator-approved filesystem quota/volume and Navidrome cache limits based on
its pinned version. Do not change global journal policy or filesystems automatically.
Transcodes remain admission-limited by the application; actual FFmpeg cancellation
and orphan cleanup require target verification. Only one application process is supported.

Validate units with `systemd-analyze verify /REVIEW/unit.service` before any install.
Do not add RestrictNamespaces=yes or MemoryDenyWriteExecute=yes casually: Bubblewrap
needs namespaces and Node needs JIT. Verify the exact chosen systemd version accepts
every directive. Templates have not been activated on this host.

## Build, accounts, local start

Build as the operator, not a runtime UID: Node24/npm11, `npm ci`, then
`npm run check`, with BASE_PATH matching the private runtime setting. The release
must include compiled workspace packages, runtime dependencies and scripts. Keep
build tools private/unexposed; never run Vite in deployed services. Use a new release
directory; do not compile into a live release. Verify every code/dependency directory
is unwritable by both runtime UIDs. Node's executable must be system-readable and
immutable to runtime UIDs; a binary beneath /home will conflict with ProtectHome.

After approval, run the dedicated engine launcher with its own private config as
its own UID. It passes only loopback settings and a minimal environment. Bubblewrap
mounts engine/config at /engine, music read-only at /music, state at /state, private
/tmp and /proc, required system runtime paths. Runtime helpers outside those paths
require exact review, not a broader host mount. Health/error logs must not reveal secrets.
Do not use `navidrome:install` against a shared existing engine; choose a new explicit
NAVIDROME_BINARY. It preserves existing binaries and verifies official checksums.

Initialize Navidrome through a loopback/SSH tunnel only, create its administrator,
then a separate non-admin engine service user using the official pinned-version
interactive CLI. Never use its administrator credential for Freeqify. Keep native
Navidrome access unexposed. Initialize Freeqify with `npm run admin:create` under its
UID and private config, in a real TTY; recovery is `npm run admin:recover`, never a
DB reset. For dedicated nologin UIDs use a reviewed explicit administrator `runuser`
command preserving the correct config only; do not grant the service a login shell.

Rootless local foreground startup uses `FREEQIFY_CONFIG_FILE=/REVIEW/server.env
npm start` and a separate `FREEQIFY_CONFIG_FILE=/REVIEW/engine.env npm run
navidrome:start`, as the respective owners. Local compiled HTTP deliberately uses
AUTH_SECURE_COOKIES=false on loopback only. Ctrl+C stops the foreground service.
Creating a same-UID rootless pilot does not meet dedicated-production isolation.

## Trusted HTTPS proxy — prepared, not authorized exposure

Local is the default. Proxy mode requires NODE_ENV=production, DEPLOYMENT_MODE=proxy,
PUBLIC_ORIGIN as one exact HTTPS origin without slash/path, TRUSTED_PROXY_PEER as
one literal loopback address, and AUTH_SECURE_COOKIES=true. HOST remains loopback.
Only one overwriting TLS proxy hop is supported. Native remote connections fail.
The socket peer, exact Host, Origin, single literal X-Forwarded-For and https protocol
must all match. Forwarded and X-Forwarded-Host are rejected. Fastify trustProxy stays
off; only validated client identity feeds request.ip/rate limits. Local processes
able to connect as the proxy peer remain trusted: dedicated identities do not turn
loopback into authenticated IPC. Protect the host; no hostile local tenants.

Review deployment/nginx.conf.example; it listens only on loopback and is deliberately
incomplete. Never replace an existing web server config. It preserves Host/Origin,
overwrites client forwarding, strips alternative forwarding headers, preserves prefix,
Range/HEAD and disables buffering/shared cache. Do not enable real_ip spoofable trust.
TLS files/certificates/listeners and LAN exposure require later approval. Verify a
dedicated hostname, real TLS cookies/CSRF, client-IP throttles, seek/cancellation and
stream/cache limits before LAN use. Public internet remains a separate review gate.

## Backup and restore

Run maintenance only as the owner of selected private source data. Stop the selected
writer first and confirm no other process uses that state. Back up each service state
and each private config directory separately under its respective identity. Use new
private backup destinations; do not merge or overwrite backups. An operator then
protects/collects the resulting bundles without broadening runtime permissions.

```sh
node scripts/maintenance.mjs backup /REVIEW/SOURCE /REVIEW/NEW-BACKUP STOPPED
```

This snapshots SQLite through its backup API, including committed WAL records;
sidecars are not copied as inconsistent standalone files. Other regular private files
are copied, links/special files rejected. It includes the whole selected state tree
(cache may be large), config only if selected separately, and a SHA-256 manifest.
Include installation.json from the preparation bundle as its own private backup.
All Freeqify tables are included: accounts/password hashes, invitations/sessions,
queue restoration, playlists/favorites/history and schema. Navidrome identifiers and
state must survive. Original music and application code are not application backups.
Backups are sensitive, unencrypted locally, 0700/0600; choose encryption/off-host
storage and retention separately. Integrity hashes detect damage, not a malicious
backup owner. The operator must know exactly which directories were selected.

```sh
node scripts/maintenance.mjs restore /REVIEW/BACKUP /REVIEW/NEW-COPY RESTORE-COPY
```

Restore verifies the manifest and creates NEW-COPY/restored. It never overwrites a
live destination. Freeqify sessions and invitations are revoked on the copy; users
sign in again and admins issue fresh invitations. Passwords and collections remain.
Navidrome sessions may remain in its snapshot: revoke them using its supported
administration before promotion, especially after an incident. Test restore with
isolated ports/config first. Moving a reviewed restored copy into service is a
separate stopped-service administrator action with a fresh pre-change backup.

Change music safely: stop engine, back up its state/config, then as the engine UID:

```sh
node scripts/maintenance.mjs music /REVIEW/engine.env /REVIEW/NEW-engine.env CONFIRM '/REVIEW/Existing Music'
```

The resolved directory is read-tested and a new private config is written. Review
it, repeat sandbox readability, then install it deliberately and restart/rescan.
No old configuration or music is overwritten. Keep the engine database for IDs.

## Update, rollback and uninstall

1. Stop only Freeqify/its dedicated engine after notifying listeners. Preserve
   private state/config/metadata with the backup workflow above; check backup copies.
2. Inventory dependencies/advisories and disk headroom for old/new release, both state
   copies, cache/WAL and backups. Do not assume the application's reserve covers all.
3. Build a NEW operator-controlled release, run checks and production asset gate.
   Keep BASE_PATH unchanged unless rebuilding deliberately. Never change applied migrations.
4. Restore the pre-update backup to NEW disposable state; point new private config at
   it. Start new code only on unused loopback ports, exercise accounts/collections and
   engine compatibility. Verify migration 5 or later without resetting user_version.
5. After approval, update exact unit release paths with services stopped. Keep config,
   music and state unchanged. Start and check health, login, playback and persistence.
6. On failure stop new code. Determine schema compatibility before restarting old code.
   The application refuses newer schemas. Code rollback may require a compatible
   backup restore: explain post-backup data loss and obtain explicit approval first.
   Never silently roll back a DB or lower user_version. Preserve failed/new state for review.

Uninstall defaults to retaining all data, config, backups and music. Stop/disable
ONLY the two reviewed Freeqify units, retain their drafts, then remove ONLY the exact
installed unit files after approval and reload systemd. Remove one exact reviewed
release at a time only after confirming it contains code, not state/config; no wildcard
cleanup. Keep service identities while retained files need ownership. Dedicated engine
binary removal is optional; shared existing Navidrome must never be removed. Data or
backup deletion is a separate request with exact paths and confirmation; no deletion
tool is provided. No uninstall command is executed during preparation.

## Troubleshooting and acceptance

A permission error is a stop point: verify UID, parents, mount and file modes, not
recursive chmod. An occupied port means choose another. A 403 behind proxy means
inspect exact origin/Host/peer/forwarding contract, not rewrite it to localhost.
A Secure-cookie failure means fix TLS/origin, not disable Secure for HTTPS. Missing
music outside /music may be an intentional symlink boundary. A failed namespace
probe means the host does not yet meet prerequisites. A schema mismatch means use
a compatible release/backup; never reset the DB.

Before acceptance: disposable admin and two listeners, invitation/login/password
change/recovery, cross-owner/admin denials, playback/seek/HEAD/cancellation, duplicate
playlists/favorites/history, paused restart, mount failures, read-only originals,
UID secrets separation, process/cache/disk budgets and restore copies. Real-host
acceptance, actual engine/transcoding, systemd and HTTPS remain unverified.

Before actual engine startup, as the exact eventual engine UID run:
`node scripts/verify-music.mjs EXPECTED_ENGINE_UID '/REVIEW/Actual Music' CONFIRM`.
It refuses another identity, checks descendant read/traverse access, rejects special
files and escaping symbolic links (reports the exact external target), and bounds
traversal to 100,000 entries. This reads names/permissions only and never indexes or
writes music. A passed read test does not replace a read-only sandbox test.

## Final deployment review: source transfer without publication

Use this workflow on the **laptop**, then over the existing approved SSH alias only.
No public Git repository is required. It transfers the reviewed working-tree source,
including uncommitted Phase 5C files, without Git history, credentials, databases,
music, node_modules, dist, caches or temporary build products. A `git archive HEAD`
now would omit uncommitted Phase 5C work; do not use it as a substitute.

`deployment/source-files.json` is an exact reviewed allowlist. It includes the lockfile,
source/public identity assets, documentation and scripts. `.env.example` contains only
example settings and is the only environment-file exception. Review source itself
for accidentally embedded secrets; no packaging tool can prove source contains none.
New files do not enter automatically; update/review the allowlist when adding source.
The packer rejects non-source names, links and overlapping output and snapshots only
the explicit files before invoking tar. Its new output directory contains source
staging, files.txt, source.tar.gz and a SHA-256 receipt; all remain private. Per-file
size is limited to 1 MiB and total source to 32 MiB. Dependencies/builds are recreated
on the OMEN with the locked versions, never copied from the laptop.

Run separately, using the beginner transfer checkpoint below for effects and rollback:

1. Review `cat deployment/source-files.json` on the laptop.
2. Create a NEW bundle with `node scripts/source-transfer.mjs /REVIEW/NEW-SOURCE-BUNDLE`.
   Its parent must be your existing 0700 private preparation directory.
3. Review `cat /REVIEW/NEW-SOURCE-BUNDLE/files.txt` and
   `tar -tzf /REVIEW/NEW-SOURCE-BUNDLE/source.tar.gz` before sending anything.
4. Through your existing approved SSH session, create a NEW owner-only incoming
   directory outside music, Plex, releases and live state. Do not alter SSH settings.
5. Send only source.tar.gz and source.tar.gz.sha256 using `scp` over the existing
   approved alias. Do not scp the whole checkout or preparation bundle.
6. On the OMEN, in that private inbox, run `sha256sum --check source.tar.gz.sha256`;
   compare the hash to the laptop receipt too. A checksum detects damage, not trusted
   origin; retain SSH host-key verification. Never bypass a changed host-key warning.
7. Review the tar listing on the OMEN. It must contain relative regular source files,
   matching the laptop files.txt. Extract only this trusted packer-generated archive
   to a NEW private staging directory using `--no-same-owner --no-same-permissions`.
   Never extract arbitrary/untrusted archives or overwrite an existing checkout/release.
8. Review Node24/npm11 availability and run `npm ci` then `npm run check` in staging,
   with a private build config and matching BASE_PATH. Provisioning a read-only release
   happens later; extraction starts no server. Preserve prior working releases.

No transfer is executed during Phase 5C preparation. Linux distributions/architecture
may differ, which is another reason to rebuild dependencies on the destination.

## Choose A or B before configuration

The user's OMEN deployment will use **A: fresh installation**. No laptop Freeqify
accounts/collections/database or Navidrome data need migration. The optional B workflow
is preserved for other explicitly reviewed cases; it is not an OMEN prerequisite.

### A. Fresh installation — new accounts and state

Choose `fresh` when the preparation tool asks. Use NEW empty private Freeqify and
Navidrome state directories, initialize their separate administrators and the non-admin
engine credential, then invitation-only listeners. Do not import an old Freeqify DB or
pretend saved playlists moved. The original laptop installation remains unchanged.
Existing music is selected in place and read-only; source transfer contains no music.
Confirm target music availability and readiness before first indexing. No pre-existing
OMEN data or shared Navidrome instance is reset or adopted.

### B. Existing installation migration — paired recovery, gated cutover

Choose `migrate`; generated engine config sets NAVIDROME_SCAN_ON_STARTUP=false.
Do **not** run admin:create on restored state. A Freeqify database alone is insufficient:
it stores opaque engine IDs in playlists, favorites, history and the saved queue.
Navidrome state, library identities/configuration, music layout/tags, and the actual
compatible engine version matter too. A newly indexed unrelated catalog may produce
missing or incorrectly reused IDs even if account login succeeds.

Upstream [persistent-ID guidance](https://www.navidrome.org/docs/usage/configuration/persistent-ids/)
describes metadata/configuration-based matching and legacy path-derived identifiers;
file moves can fail matching. This is **not** a guarantee that every external client's
saved ID survives a host/path change. Navidrome's
[0.64.0 migration notes](https://github.com/navidrome/navidrome/releases/tag/v0.64.0)
explicitly changed ID representation. Avoid combining migration with an engine upgrade,
PID/config changes, renamed folders, new libraries, retagging or format conversion.
If versions are incompatible or old IDs no longer resolve, STOP for separate review;
never SQL-rewrite IDs or purge missing media to make migration appear successful.

The Bubblewrap launcher presents the selected host directory as `/music`. If the old
engine already used that same logical root, preserving engine state and relative
music layout avoids one category of path change. This is an inference about reducing
changes, not a validated native-engine migration guarantee. An old external-isolation
installation may instead store a host path. Environment configuration alone must not
be assumed to update all library-root records. Keep the old logical path/configuration
where safely possible and verify on copies with the same engine version; otherwise
stop. Freeqify does not move/copy music as part of migration. Confirm the existing OMEN
collection really contains the same files/relative layout/tags or review a separate
read-only media availability plan. Do not reorganize either collection.

#### Paired snapshot, transfer and restore sequence

Each step is individually guided and requires the separately authorized deployment
session. Never run against live databases during this preparation phase.

1. Inventory exact source Freeqify release/schema, engine version and binary checksum,
   logical library roots, music relative layout, engine PID/scanner options, credentials
   and private paths. Record versions/roots in private migration-notes.json, without
   passwords. Do not inspect another person's collections in chat.
2. Schedule a quiet maintenance window. Stop only source Freeqify to freeze account/
   collection writes. Temporarily keep its engine available locally for baseline
   getSong reads, with no scan/reorganization in progress. Make a consistent private
   Freeqify backup; use its payload DB as a read-only review copy. Do not promote a
   restore simply to generate the source baseline.
3. As the data/config owner, with built reviewed source and an explicit private server
   config pointing to the SOURCE engine, capture all saved references:
   `node scripts/migration-review.mjs capture /REVIEW/WEB-BACKUP/payload/freeqify.sqlite /REVIEW/SOURCE-server.env /REVIEW/NEW-reference-baseline.json`.
   It reads schema-5 copies, includes playlist/favorite/history/queue-only IDs, calls
   fixed supported Subsonic getSong through the existing adapter, and writes a private
   ID/status/metadata-fingerprint baseline. It never rewrites IDs. Outages, malformed
   responses or unexpected aliases fail. Record any **already missing** references
   explicitly; preservation is not a promise to repair them. Empty collections yield
   an empty reference baseline and therefore need extra catalog/playback sampling.
4. Stop the dedicated source engine. Verify neither writer is still running and no
   one restarts them while copying. Back up the whole selected engine state (catalog,
   related DBs/keys/settings, cache where present), both private config directories,
   credentials/encryption keys, installation metadata, notes and the baseline. Use
   each source owner's private backup operation separately; do not chmod directories
   broadly so another UID can read them. Keep the initial Freeqify snapshot from the
   same maintenance window frozen. If either service resumes writes or media changes
   before cutover, stop and make a new coordinated set/baseline.
5. Give the coordinated set one operator-chosen unique label in private notes. Record
   every component's path and SHA-256 manifest/receipt, captured time, source release,
   schema/engine version and logical music root. Do not mix sets from different times
   or installations. No public manifest may expose credentials or private listening data.
6. Transfer this **sensitive migration set separately from source** over approved SSH.
   Use an operator-owned private staging copy of the exact selected backup bundles;
   per-UID collection may require separately approved administrator copies. Do not run
   scp as a service UID or grant it SSH keys. `scp -r` is appropriate only for this
   explicitly curated private set, never arbitrary home/music/checkouts. Receive into
   a NEW 0700 private inbox, preserve 0600 files, and verify every component's checksum
   and manifest against source receipts. Configuration/secrets are intentionally part
   of migration recovery, never ordinary source transfer. Encryption at rest/off-host
   retention remains an explicit operator choice; SSH protects transit only.
7. On the target, restore each state/config component to a NEW isolated destination,
   with the existing copy-only restore tool and no live replacement. Preserve source
   backups and all existing target data. Install only reviewed config values for new
   paths/ports and the same engine credentials/key/PID/library settings; configs
   containing old paths cannot be used unchanged. Set the final files' exact per-UID
   ownership individually after approval. Do not copy source numeric UIDs blindly.
   Freeqify restore revokes sessions/invitations; accounts/passwords/collections remain.
   Review/revoke upstream sessions with supported engine tools before cutover.
8. Verify the actual music mount and existing witness on the OMEN as its eventual
   engine UID. Capture a **new target readiness proof**; source mount paths/UUIDs may
   differ, so never blindly reuse a source readiness file. Keep the engine's intended
   logical library root and relative file layout consistent. Repeat exact-UID access
   and sandbox checks. Do not create a new catalog to bypass a restored catalog error.
9. Start the restored engine COPY with the same compatible binary and
   NAVIDROME_SCAN_ON_STARTUP=false on an unused loopback port. The launcher also
   disables scheduled/watcher scans and forces missing-file purge to never. Confirm
   the actual version honors these settings. Automatic engine schema migration may
   still occur at startup, so never start a different version against the only backup.
10. Use a NEW explicit private server-review config targeting that engine copy:
    `node scripts/migration-review.mjs check /REVIEW/RESTORED-WEB/restored/freeqify.sqlite /REVIEW/TARGET-server-review.env /REVIEW/reference-baseline.json`.
    It checks every saved ID/status/metadata fingerprint and fails on new missing,
    reused/replaced or changed IDs, including queue-only references. A pass is necessary
    but not sufficient: equal metadata does not prove identical audio or correct paths.
11. Verify representative original-audio playback/seek (including tracks across drives
    and saved collections), inspect library roots/missing counts, compare selected
    source/target audio checksums under owner control, and review all already-missing
    references. Only then, on **another disposable engine state copy**, enable a guarded
    startup scan after mount readiness. Re-run the entire reference comparison AFTER
    the scan and playback checks. Keep the pre-scan copy and original paired backups.
    Do not trigger unguarded native UI/CLI scans or “fix”/purge commands.
12. Start the restored Freeqify copy with isolated config/ports. Verify existing known
    credentials, duplicate playlist order, favorites/history, queue paused restoration,
    manual owner separation and restart. Compare account/collection counts to source
    privately without logging hashes/tokens. Do not bootstrap or reset accounts.
13. **STOP until native-engine/path/post-scan acceptance succeeds.** Synthetic tests
    exercise paired restore and fail-closed reference comparison, not Navidrome's real
    scanner migration. If native validation is unavailable or anything differs, retain
    source service/state and both backups; do not cut over, remap IDs, silently create
    new accounts/catalogs or replace target data. Actual promotion needs explicit
    approval and a rollback plan. If the laptop resumes use, all newer changes must
    be included in a new coordinated set before a later cutover.

The migration-review CLI is offline-owner tooling, not an administrator HTTP route.
Use it only on private state copies; its baseline contains private identifiers and
must not be pasted into chat. It is bounded to 100,000 unique references and 32 MiB
baseline files. Unsupported schema/state, too many references or a failed comparison
is a STOP, not permission to truncate. No automatic cross-version ID mapping is implemented.

## Required music readiness before any guarded startup scan

The launcher now refuses to start without MUSIC_READINESS_FILE. Mere directory
existence/readability is insufficient: a disconnected drive can leave an empty
mountpoint on the root filesystem. `findmnt` (util-linux) is a prerequisite. Readiness
records the containing mount target, stable filesystem UUID, filesystem type,
filesystem root (including bind/subvolume identity), resolved music path, and an
existing nonempty regular file witness (size plus SHA-256 of up to its first 64 KiB).
It writes only a private proof, **never a marker or any file inside music**. The
witness must have no symlink components; choose a stable existing representative file.

After you independently confirm the correct drive is mounted and visible, as engine
config owner, run ONE command:
`node scripts/music-readiness.mjs capture '/REVIEW/Actual Music' /REVIEW/engine-config/music-readiness.json 'Artist/Album/Existing Song.flac' CONFIRM-MOUNTED`.
The parent must be private 0700; proof is new 0600. Review the displayed mount/UUID
against `findmnt --json --target '/REVIEW/Actual Music' --output TARGET,UUID,FSTYPE,FSROOT`
first. Point engine.env MUSIC_READINESS_FILE to this proof (wizard defaults to a
music-readiness.json file beside engine.env; use that new filename when first capturing).
Then `node scripts/music-readiness.mjs check '/REVIEW/Actual Music' /REVIEW/engine-config/music-readiness.json`
performs a read-only readiness check. Capture also works for an internal directory
by recording its containing root/data filesystem; do not falsely require the music
subdirectory itself to be a mountpoint. Filesystems without a stable discoverable
UUID or ambiguous mount identity fail closed and need separate host-specific review;
there is no permissive skip flag.

The verifier compares UUID/type and the effective filesystem-relative music root.
It permits systemd's additional read-only bind view of the **same** subtree, while
rejecting another filesystem or subtree. The original target/fsroot remain visible
in the private proof for operator review; a missing drive's fallback parent filesystem
does not acquire the expected UUID by leaving a directory behind.

Every engine launch checks readiness before state creation and again immediately
before spawning. Missing mount/witness, wrong drive, different path, changed witness
or absent/unsafe proof stops before engine indexing. A service may log repeated failures;
correct the actual mount through the host's established approved process, check proof,
then deliberately restart. Never recapture proof while the drive is absent to clear
an error. Music reconfiguration clears the old readiness setting; capture/review a
new proof before restarting. A truly empty collection cannot pass this guarded mode
and requires a separately designed empty-library workflow, not an implicit assumption.

Startup scan defaults true for fresh drafts and false for migration drafts. Scheduled
and watcher scans are disabled by the launcher; purge-missing is forced to never.
For an approved rescan, stop the engine, confirm/check readiness, then restart with
NAVIDROME_SCAN_ON_STARTUP=true. For migration, do this only on disposable copies until
post-scan reference checks pass. Keep native engine administration unexposed and do
not bypass the launcher for scans. These options are documented in upstream
[scanner configuration](https://www.navidrome.org/docs/usage/configuration/options/).

This is a startup/rescan workflow gate, not a hot-unplug interlock. Physical removal,
I/O failure or an administrator forcing a scan after startup can still race checks;
readiness cannot lock hardware availability. Stop the dedicated engine BEFORE
unmounting/removing a drive; do not disconnect media during a scan. A read-only bind
inside Bubblewrap does not guarantee a disconnected physical device remains usable.
Verify actual mount/namespace behavior on the OMEN without modifying fstab, mounts,
Plex or storage configuration during preparation.

At target acceptance, repeat readiness under the actual hardened service namespace,
including PrivateDevices/ReadOnlyPaths, as well as the engine UID. UUID discovery may
differ from the operator shell. If it is unavailable there, stop for a specific safe
host design; do not disable device/home isolation or skip readiness to get a green
startup. The synthetic bind-view regression does not certify that host behavior.
