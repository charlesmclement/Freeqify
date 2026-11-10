# Audiobooks

Freeqify has a separate audiobook catalog and private bookshelf. Books stream by
default, with optional original-format downloads to the listening device. Each
account has its own resume position, bookmarks, chapter names, speed and book status.
The player includes a sleep timer and keeps the music queue separate.

## Connect the source

Register your audiobook directory, such as `files/Audiobooks`, as a separate
read-only library in Navidrome. Give the dedicated Freeqify service account access
to that library and your music library. Keep credentials in the private server
configuration. Freeqify never changes the original files or their tags.

The default library name is `Audiobooks`. Set `AUDIOBOOKS_LIBRARY_NAME` for a different
name, or set `AUDIOBOOKS_MUSIC_FOLDER_ID` to its Navidrome library ID. If the service
account can see multiple music libraries, set `NAVIDROME_MUSIC_FOLDER_ID` to the
music library ID. Music and books must use different libraries.

All source books appear in Audiobooks. Opening a book creates its private bookshelf
entry; the source catalog itself does not save listening state. Existing saved books
retain their notes and position when reopened.

## Chapters and spoken headings

Files supply part boundaries. Installed `ffprobe` reads embedded chapter markers,
when present; `AUDIOBOOKS_FFPROBE_PATH` can select the executable. A file without an
embedded chapter table remains a usable part. External CUE files are not read through
this integration. You can add or edit markers manually.

Optional local Whisper recognition reads the opening words at existing section
breaks. It does not guess the number of introductions or prologues, and does not
invent section boundaries. Use **Read spoken headings**, review or edit the
suggestions, and choose **Save selected names**. Unclear speech leaves the old name
available. Saved corrections survive another embedded-chapter scan.

Install OpenAI Whisper in a private Python environment and obtain a compatible model
before enabling recognition. Configure both `AUDIOBOOKS_SPEECH_PYTHON` and
`AUDIOBOOKS_SPEECH_MODEL`; optionally set `AUDIOBOOKS_FFMPEG_PATH`. The executable,
model and directories must be accessible to the unprivileged application user.
The runtime never downloads a model and uses no cloud transcription or Codex calls.
See [Whisper installation](https://github.com/openai/whisper) for installation details.

Recognition runs on CPU with bounded audio samples and one operation at a time.
It can take tens of seconds per section. Suggestions currently recognize explicit
English headings; review is required because speech recognition can mishear words.
Cancelling stops the remaining work without saving names.

## Device downloads and upgrades

**Download book** saves the original files to browser storage. **Play downloaded
copy** selects that copy explicitly; online listening otherwise streams. Offline
progress and bookmarks can be synchronized when reconnected. Conflicting changes
require a choice instead of silently replacing the other device's state. Browser
storage limits, eviction, codec support and background restrictions still apply.

Keep `DATA_DIR` outside the checkout and back it up before upgrading. Migration 13
adds audiobook storage without resetting accounts, sessions or music collections.
An older release that only supports schema 12 cannot open a migrated database;
retain the earlier release and its consistent database backup together.

The existing 30-day session defaults and automatic connection recovery are retained.
Explicit configuration overrides defaults; existing sessions retain their stored
expiry until the next login.

## Book covers and bottom player

Books show their cover, title, author and chapter in the persistent bottom player.
Original Navidrome artwork takes priority. To enable optional Open Library matching
and administrator cover search, set `AUDIOBOOKS_COVER_CONTACT` to an identifiable
email or project URL in the server configuration. No API key is required. The server
sends book title and author to Open Library and caches validated images privately;
original audio and artwork files are never changed.

Automatic lookup requires an exact normalized author/title match. It can omit a
subtitle when matching; if several editions match, the first matching result supplies
the cover. The edition may differ from your audiobook. Use **Edit book cover** to
search, preview and choose another edition. Administrator-selected shared covers
apply to everyone. Personal uploads and choices are retained underneath and restored
when the shared cover is removed. Optional lookup never blocks playback.

Audiobooks now use the same bottom Now Playing bar and expanded listening view as music.
Tap the book title to open Now Playing. The book button opens chapters and options
for speed, sleep, bookmarks, volume and returning to the saved music queue. Opening
or closing either view preserves the current audio source and listening position.

If a book stream fails, Play retries the source at the retained position. Retrying is explicit and does not mark the book finished.

## Synchronized transcripts

Open Now Playing, choose Mode → Lyrics, and read locally generated Whisper text.
The existing optional speech Python environment and model configuration also
supply the reader for these transcripts. Server recognition also requires explicit
`AUDIOBOOKS_TRANSCRIPTS_ENABLED=true` and defaults off. Recognition covers 30-second passages and prepares one
next passage; it may lag on slow CPUs. Text is private to the listener and cached
under existing storage quotas through additive migration 14. Tap a line to seek;
manual scrolling pauses following. Words and timing may contain recognition errors.
No audio is uploaded, rewritten or saved by the recognizer. A local model must
already exist; no paid API or model download is required. Closing the panel cancels
pending work. Immersive mode supports transcripts and optional Keep screen awake.
