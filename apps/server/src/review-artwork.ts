/** Read-only bridge for the strict-match scanner's existing downloads. No music paths are read. */
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, join } from 'node:path';
import type { Artwork } from './integrations/navidrome.js';
import { imageType } from './online-artwork.js';

export function artworkName(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
}
async function boundedFile(path: string, limit: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('Invalid review file');
    const bytes = Buffer.alloc(stat.size);
    let offset=0;
    while(offset<bytes.length){
      const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);
      if(!bytesRead)throw new Error('Incomplete review file');
      offset+=bytesRead;
    }
    return bytes;
  } finally { await handle.close(); }
}
export async function reviewedArtwork(directory: string, artist: string, title: string): Promise<Artwork | null> {
  try {
    const report = JSON.parse((await boundedFile(join(directory, 'report.json'), 4 * 1024 * 1024)).toString('utf8'));
    if (!Array.isArray(report.results)) return null;
    const matches = report.results.filter((entry: Record<string, unknown>) =>
      entry && typeof entry.artist === 'string' && typeof entry.album === 'string'
      && artworkName(entry.artist) === artworkName(artist) && artworkName(entry.album) === artworkName(title)
      && ['downloaded', 'previously-downloaded'].includes(String(entry.status)));
    if (matches.length !== 1) return null;
    const entry = matches[0];
    // Derive the scanner's exact filename, never trust an arbitrary report path.
    const hash = createHash('sha256').update(`${entry.artist}\0${entry.album}`).digest('hex').slice(0, 24);
    if (typeof entry.file !== 'string') return null;
    const name = basename(entry.file);
    const ext = name.slice(hash.length);
    const type = ({ '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' } as Record<string, string>)[ext];
    if (!type || name !== hash + ext) return null;
    const bytes = await boundedFile(join(directory, 'downloaded', name), 3 * 1024 * 1024);
    return imageType(bytes, type) ? { bytes, contentType: type } : null;
  } catch { return null; }
}
