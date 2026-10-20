import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { OnlineAlbumArtwork } from '../apps/server/dist/online-artwork.js';

const root = path.resolve(process.argv[2] || path.join(os.homedir(), 'Music'));
const output = path.join(os.homedir(), '.local/share/freeqify-artwork-review');
const images = path.join(output, 'downloaded');
const extensions = new Set([
  '.mp3', '.wav', '.flac', '.ogg', '.opus',
  '.m4a', '.aac', '.aiff', '.aif', '.wma'
]);
const coverNames = [
  'cover.jpg', 'cover.jpeg', 'cover.png',
  'folder.jpg', 'folder.png',
  'front.jpg', 'front.png',
  'album.jpg', 'album.png'
];

if (!process.env.MB_CONTACT?.trim()) {
  throw new Error('MusicBrainz contact is required');
}

fs.mkdirSync(images, { recursive: true, mode: 0o700 });

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(file);
    else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      yield file;
    }
  }
}

function getTag(tags, name) {
  const wanted = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const found = Object.entries(tags).find(([key]) =>
    key.toLowerCase().replace(/[^a-z0-9]/g, '') === wanted
  );
  return typeof found?.[1] === 'string' ? found[1].trim() : '';
}

const albums = new Map();
let files = 0;
let untagged = 0;
let unreadable = 0;

console.log('\nScanning music files...');

for (const file of walk(root)) {
  files++;
  let info;

  try {
    const raw = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format_tags:stream_disposition=attached_pic',
      '-of', 'json',
      '-i', file
    ], {
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 1024 * 1024
    });
    info = JSON.parse(raw);
  } catch {
    unreadable++;
    continue;
  }

  const tags = info.format?.tags ?? {};
  const album = getTag(tags, 'album');
  const artist = getTag(tags, 'albumartist') ||
                 getTag(tags, 'artist');

  if (!album || !artist) {
    untagged++;
    continue;
  }

  const embedded = info.streams?.some(
    stream => stream.disposition?.attached_pic === 1
  ) ?? false;

  const folderCover = coverNames.some(name =>
    fs.existsSync(path.join(path.dirname(file), name))
  );

  const key = `${artist.toLowerCase()}\0${album.toLowerCase()}`;

  if (!albums.has(key)) {
    albums.set(key, {
      artist, album, tracks: 0,
      localArtwork: false
    });
  }

  const entry = albums.get(key);
  entry.tracks++;
  entry.localArtwork ||= embedded || folderCover;
}

const all = [...albums.values()];
const missing = all.filter(album => !album.localArtwork);

console.log('\n--- LIBRARY INVENTORY ---');
console.log('Music files:', files);
console.log('Unique tagged albums:', all.length);
console.log('Albums with local artwork:', all.length - missing.length);
console.log('Albums needing lookup:', missing.length);
console.log('Files without album/artist tags:', untagged);
console.log('Files that could not be inspected:', unreadable);

const provider = new OnlineAlbumArtwork({
  contact: process.env.MB_CONTACT,
  fetcher: async (url, options) => {
    const response = await fetch(url, options);

    if (new URL(url).hostname === 'musicbrainz.org') {
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (remaining !== null) {
        quotaRemaining = Number(remaining);
      }
    }

    return response;
  }
});

let quotaRemaining = Infinity;
let lookups = 0;
let found = 0;
let stopped = false;
const results = [];

console.log('\n--- BATCH LOOKUP ---');

for (const album of all) {
  const item = { ...album };

  if (album.localArtwork) {
    item.status = 'existing-local';
    results.push(item);
    continue;
  }

  const id = crypto.createHash('sha256')
    .update(`${album.artist}\0${album.album}`)
    .digest('hex').slice(0, 24);

  const existing = ['jpg', 'png', 'webp']
    .map(ext => path.join(images, `${id}.${ext}`))
    .find(fs.existsSync);

  if (existing) {
    item.status = 'previously-downloaded';
    item.file = existing;
    results.push(item);
    continue;
  }

  if (quotaRemaining <= 5 || lookups >= 50 || stopped) {
    item.status = 'pending';
    results.push(item);
    continue;
  }

  lookups++;
  console.log(`Checking: ${album.artist} — ${album.album}`);

  const result = await provider.lookup(album.artist, album.album);

  if (result.kind === 'found') {
    const ext = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp'
    }[result.artwork.contentType];

    const destination = path.join(images, `${id}.${ext}`);

    fs.writeFileSync(destination, result.artwork.bytes, { flag: 'wx' });
    item.file = destination;
    item.status = 'downloaded';
    found++;

    console.log('  Found genuine cover');
  } else if (result.kind === 'missing') {
    item.status = 'missing-online';
    console.log('  No confirmed matching cover');
  } else {
    item.status = 'unavailable';
    stopped = true;
    console.log('  Service unavailable; remaining lookups deferred');
  }

  results.push(item);
}

const report = {
  scannedAt: new Date().toISOString(),
  root,
  files,
  untagged,
  unreadable,
  albumCount: all.length,
  musicBrainzLookups: lookups,
  downloaded: found,
  remainingQuota: Number.isFinite(quotaRemaining) ? quotaRemaining : null,
  results
};

fs.writeFileSync(
  path.join(output, 'report.json'),
  JSON.stringify(report, null, 2),
  { mode: 0o600 }
);

console.log('\n--- FINAL RESULTS ---');
console.log('Albums checked online:', lookups);
console.log('Covers downloaded:', found);
console.log('Albums needing further work:',
  results.filter(x => ['missing-online', 'unavailable', 'pending'].includes(x.status)).length
);
console.log('Report:', path.join(output, 'report.json'));
console.log('Covers:', images);
