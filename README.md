# Freeqify

**Your Music. Your Frequency.**

Free, open-source, self-hosted music streaming for your own music collection.
Freeqify provides a React interface backed by a private Node.js server and a
Navidrome catalog. Bring your own legally obtained music; no music is bundled.

## Features

- Browse and search artists, albums, and tracks.
- One persistent player, playback queue, and visualizers.
- Private accounts with administrator-controlled invitations.
- Personal playlists, song favorites, and listening history.
- Mobile layouts and an installable progressive web app.
- Explicit device downloads and offline playback of saved music, subject to browser storage limits.
- Personal artwork choices and optional administrator cover search.

This is an actively developed project. There is no public demo or hosted service.
Publishing the source does not expose an existing installation.

## Requirements

Native Linux, Node.js 24, npm 11+, and a compatible Navidrome installation.
The bundled engine tooling also requires FFmpeg and tar, with Bubblewrap for its
default read-only isolation. Docker is not required. Music must remain read-only;
Freeqify never needs to modify your original audio or its tags.

## Getting started

```sh
git clone https://github.com/charlesmclement/Freeqify.git
cd Freeqify
npm ci
npm run build
```

Read [.env.example](.env.example) and the
[Linux installation preparation guide](docs/linux-installation.md) before starting
services. The preparation tools produce reviewable configuration and service
bundles; they do not automatically deploy the application.

Keep configuration, credentials, databases, and backups outside the checkout and
outside your music directory. Set an existing music directory and a separate
Navidrome state directory. Use a dedicated non-administrator Navidrome service
account; keep its credentials server-side. Existing Navidrome installations and
other services must not be changed without their owner's approval.

With private configuration and read-only engine isolation in place, run the engine
and application in separate terminals:

```sh
npm run navidrome:start
npm run dev
```

Create the initial Freeqify administrator from an interactive local terminal:

```sh
npm run admin:create
```

The application binds loopback by default. Open the configured loopback URL (the
example defaults use `http://127.0.0.1:3000`). Invited listeners create their own
accounts; there is no public signup. Do not expose development middleware publicly.
For production, use the compiled build and `npm start`; review HTTPS, proxy, cookie,
and URL-prefix configuration before any remote access.

## Development and validation

```sh
npm run check
```

This runs lint, all workspace TypeScript checks, automated tests, and production
builds. The npm workspaces are `apps/web`, `apps/server`, and `packages/shared`.
Shared code contains public contracts only.

See [architecture](docs/architecture.md),
[personal library API](docs/personal-api.md), and
[Linux installation preparation](docs/linux-installation.md).

## Privacy and data

Accounts, sessions, invitations, and personal collections use SQLite with additive
versioned migrations. Updates must preserve existing data. Navidrome credentials
and upstream service URLs stay on the server; never put secrets in `VITE_*` values.
Device downloads are explicit and use browser storage; private audio is not placed
in the service worker cache. Storage can be revoked or evicted by the browser.

## License

Freeqify is licensed under the **GNU General Public License version 3 only**
(`GPL-3.0-only`). See [LICENSE](LICENSE) for the full terms.

You may use, modify, and redistribute Freeqify, including commercially. Distributing
modified versions requires providing corresponding source under GNU GPL v3 as the
license requires. Private modifications and hosting alone do not require publishing
changes. Third-party components retain their own licenses, including the notices
in `apps/web/src/milkdrop/`. Music and personal library data are not covered by the
software license.
