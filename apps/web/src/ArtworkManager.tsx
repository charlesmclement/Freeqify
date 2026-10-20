import { useEffect, useRef, useState } from 'react';
import { readLibrary } from './library-api.js';
import { AlbumArtworkEditor } from './AlbumArtworkEditor.js';

type Album = {
  id: string;
  title: string;
  artist: string;
  year?: number;
};

type AlbumPage = {
  items: Album[];
};

export function ArtworkManager() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function scan() {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;

    setBusy(true);
    setError('');
    setScanned(false);

    try {
      const collected = new Map<string, Album>();

      for (let offset = 0; offset < 10000; offset += 100) {
        const page = await readLibrary<AlbumPage>(
          `albums?limit=100&offset=${offset}`,
          request.signal
        );

        if (!Array.isArray(page.items)) {
          throw new Error('Unexpected album catalog response.');
        }

        for (const album of page.items) {
          if (typeof album.id === 'string' &&
              typeof album.title === 'string' &&
              typeof album.artist === 'string') {
            collected.set(album.id, album);
          }
        }

        if (page.items.length < 100) {
          setAlbums([...collected.values()]);
          setScanned(true);
          return;
        }
      }

      throw new Error('Album catalog exceeded the scan limit.');
    } catch (reason) {
      if (!request.signal.aborted) {
        setError(reason instanceof Error
          ? reason.message : 'Could not scan the library.');
      }
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }

  return <section aria-label="Artwork Manager">
    <p className="library-caption">
      Manage album artwork across your Freeqify library.
      Existing selections and original music files are preserved.
    </p>

    <div className="artwork-edit-actions">
      <button type="button" onClick={() => void scan()} disabled={busy}>
        {busy ? 'Scanning catalog…' : 'Scan album catalog'}
      </button>
    </div>

    {error && <p role="alert" className="account-error">{error}</p>}

    {scanned && <>
      <h3 className="library-detail-title">
        {albums.length} albums discovered
      </h3>
      <p className="library-caption">
        Album inventory complete. Automatic online artwork checks
        and review statuses will be added in the next stage.
      </p>

      {albums.length === 0
        ? <p className="library-caption">No albums found.</p>
        : <div className="track-list">
          <table>
            <thead><tr>
              <th>Artist</th>
              <th>Album</th>
              <th>Artwork</th>
            </tr></thead>
            <tbody>
              {albums.map(album => <tr key={album.id}>
                <td>{album.artist}</td>
                <td>
                  {album.title}
                  {album.year ? ` (${album.year})` : ''}
                </td>
                <td>
                  <AlbumArtworkEditor albumId={album.id} artist={album.artist} title={album.title}/>
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>}
    </>}
  </section>;
}
