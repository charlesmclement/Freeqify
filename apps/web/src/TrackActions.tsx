import {DownloadButton} from './DownloadButton.js';
import {SongAddButton} from './SongAddButton.js';
import { useState } from 'react';
import type { Track } from '@freeqify/shared';
import { usePersonal } from './PersonalContext.js';
export function TrackActions({track,downloadPlaceholder=false}: {track: Track;downloadPlaceholder?:boolean}) {
  const personal=usePersonal(); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  if (!personal) return null;
  const favorite=personal.summary.favoriteIds.includes(track.id);
  return <span className="personal-track-actions"><button aria-label={`${favorite?'Unfavorite':'Favorite'} ${track.title}`} aria-pressed={favorite} disabled={busy||personal.loading||Boolean(personal.error)} onClick={()=>{setBusy(true);setError('');void personal.mutate('favorites',{source:'local',trackId:track.id,enabled:!favorite}).catch(reason=>setError(reason instanceof Error?reason.message:'Could not update favorite.')).finally(()=>setBusy(false));}}>{favorite?'♥':'♡'}</button>{!downloadPlaceholder&&<SongAddButton track={track}/>}<DownloadButton track={track}/>{error && <span role="alert" className="account-error">{error}</span>}</span>;
}
