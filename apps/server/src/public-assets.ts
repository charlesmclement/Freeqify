import { constants } from 'node:fs';
import { open, readdir, realpath, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import { approvedFeatureAssets } from './approved-feature-assets.js';

const types: Record<string,string> = { html:'text/html', js:'text/javascript', css:'text/css', png:'image/png', webmanifest:'application/manifest+json', svg:'image/svg+xml', woff2:'font/woff2', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp' };
// Exact filenames must be approved in source control before they can ship.
// This also provides a single registry for future static feature bundles.
const featureDirectories = new Set(Object.keys(approvedFeatureAssets));
const featureFiles = new Set(Object.entries(approvedFeatureAssets)
  .flatMap(([directory, filenames]) => filenames.map(name => `${directory}/${name}`)));
/** Only build outputs and explicitly approved feature files are ever served. */
export function publicAsset(path: string) {
  return featureFiles.has(path) || ['index.html','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png','sw.js','app.js'].includes(path)
    || /^assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|png|svg|woff2)$/.test(path);
}
const fdPath = (handle: FileHandle) => `/proc/self/fd/${handle.fd}`;
// Linux O_PATH (not exposed by Node) traverses execute-only host ancestors.
// Listing still requires read permission on the actual public artifact folders.
const directoryFlags = 0x200000 | constants.O_DIRECTORY | constants.O_NOFOLLOW;
async function rootDirectory(path: string) {
  // Walk from / using open directory descriptors; O_NOFOLLOW applies to each component.
  let handle = await open('/', directoryFlags);
  try {
    for (const component of resolve(path).split('/').filter(Boolean)) {
      const next = await open(`${fdPath(handle)}/${component}`, directoryFlags);
      await handle.close(); handle = next;
    }
    if (await realpath(fdPath(handle)) !== resolve(path)) throw new Error('Unsafe public artifact directory');
    return handle;
  } catch { await handle.close(); throw new Error('Public artifact path must contain only real directories, without symlinks'); }
}
export async function loadPublicAssets(root: string, strict = false) {
  const assets = new Map<string,{bytes:Buffer;type:string}>();
  const directory = await rootDirectory(root);
  let total = 0;
  async function visit(parent: FileHandle, prefix = '') {
    const entries=await readdir(fdPath(parent), {withFileTypes:true});
    if(entries.length>1024)throw new Error('Too many public artifacts');
    for (const entry of entries) {
      const name = prefix + entry.name;
      if (entry.isDirectory() && (name === 'assets' || featureDirectories.has(name))) {
        const child = await open(`${fdPath(parent)}/${entry.name}`, directoryFlags);
        try { await visit(child, `${name}/`); } finally { await child.close(); }
      } else if (entry.isFile() && publicAsset(name)) {
        // Descriptor-relative parent plus final O_NOFOLLOW prevents path replacement escapes.
        let file: FileHandle;
        try { file = await open(`${fdPath(parent)}/${entry.name}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
        catch { throw new Error('Public artifact changed during validation; rebuild and restart'); }
        try {
          const info = await file.stat();
          if (!info.isFile() || info.size > 16*1024*1024 || total + info.size > 64*1024*1024) throw new Error('Invalid or oversized public artifacts');
          const resolved = await realpath(fdPath(file));
          if (resolved !== resolve(root, name)) throw new Error('Public artifact escaped its directory');
          // Bounded read even if a concurrent writer grows the opened file.
          const bytes = Buffer.alloc(info.size + 1);
          let size = 0;
          while (size < bytes.length) { const read = await file.read(bytes,size,bytes.length-size,null); if (!read.bytesRead) break; size += read.bytesRead; }
          const after = await file.stat();
          if (size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error('Public artifact changed during validation');
          total += size;
          assets.set(name,{bytes:bytes.subarray(0,size),type:types[name.split('.').pop()!]!});
        } finally { await file.close(); }
      } else if(strict)throw new Error('Unexpected or non-regular file in public build output; remove private or unapproved artifacts');
    }
  }
  try { await visit(directory); } finally { await directory.close(); }
  if (!assets.has('index.html')) throw new Error('Missing regular public index.html; rebuild frontend');
  // Immutable in-memory snapshot: serving never reopens filesystem paths after validation.
  return assets;
}
