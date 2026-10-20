import { useEffect, useState, type FormEvent } from 'react';
import type { Account, Invitation } from '@freeqify/shared';
import { accountRequest } from './auth-api.js';
import { useAccount } from './Authentication.js';
import { ArtworkManager } from './ArtworkManager.js';
export function Administration() {
  const { state } = useAccount();
  const [panel, setPanel] = useState<'listeners' | 'artwork'>('listeners');
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [users, setUsers] = useState<Account[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [link, setLink] = useState('');
  const [expiry, setExpiry] = useState(() => {
    const date = new Date(Date.now() + 86400000); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([accountRequest<{ items: Invitation[] }>('admin/invitations', undefined, undefined, controller.signal), accountRequest<{ items: Account[] }>('admin/users', undefined, undefined, controller.signal)])
      .then(([invites, accounts]) => { if (!controller.signal.aborted) { setInvitations(invites.items); setUsers(accounts.items); } })
      .catch(() => { if (!controller.signal.aborted) setError('Could not load administrator tools.'); });
    return () => controller.abort();
  }, [revision]);
  async function action(path: string, input: unknown, success: string) {
    setBusy(true); setError(''); setMessage('');
    try { const result = await accountRequest(path, state!.csrf, input); setRevision(n => n + 1); setMessage(success); return result; }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The request failed.'); return null; }
    finally { setBusy(false); }
  }
  async function create(event: FormEvent) {
    event.preventDefault(); setLink('');
    const result = await action('admin/invitations', { expiresAt: new Date(expiry).getTime() }, 'Invitation created. Save the link now; it is shown only once.') as { token: string } | null;
    if (result) setLink(`${window.location.origin}${import.meta.env.BASE_URL}#invite=${encodeURIComponent(result.token)}`);
  }
  if (panel === 'artwork') return <section className="admin-panel music-library">
    <div className="section-title"><h2>Artwork Manager</h2><span>ADMINISTRATOR</span></div>
    <div className="artwork-edit-actions">
      <button type="button" onClick={() => setPanel('listeners')}>Invitations & listeners</button>
      <button type="button" aria-current="page">Artwork Manager</button>
    </div>
    <ArtworkManager />
  </section>;

  return <section className="admin-panel music-library"  aria-labelledby="admin-title"><div className="section-title"><h2 id="admin-title">Invitations & listeners</h2><span>ADMINISTRATOR</span></div>
    <div className="artwork-edit-actions">
      <button type="button" aria-current="page">Invitations & listeners</button>
      <button type="button" onClick={() => setPanel('artwork')}>Artwork Manager</button>
    </div>
    <p className="library-caption">A private collection, shared by invitation. Links expire and can be used once. This phase remains accessible only on this machine.</p>
    {error && <p role="alert" className="account-error">{error}</p>}{message && <p role="status" className="library-caption">{message}</p>}
    <form className="invitation-form" onSubmit={create}><label>Invitation expires<input type="datetime-local" required value={expiry} onChange={event => setExpiry(event.target.value)} /></label><button type="submit" disabled={busy}>Create invitation</button></form>
    {link && <div className="invitation-link"><label>New invitation link (shown once)<input readOnly value={link} onFocus={event => event.target.select()} /></label><button onClick={() => { void navigator.clipboard?.writeText(link).then(() => setMessage('Invitation link copied.')).catch(() => setMessage('Select the link and copy it manually.')); }}>Copy link</button><button onClick={() => setLink('')}>Hide link</button></div>}
    <h3 className="library-detail-title">Invitations</h3>{invitations === null ? <p className="library-caption">Loading invitations…</p> : invitations.length === 0 ? <p className="library-caption">No invitations created yet.</p> : <div className="track-list"><table><thead><tr><th>Created</th><th>Expires</th><th>Status</th><th>Action</th></tr></thead><tbody>{invitations.map(invite => <tr key={invite.id}><td>{new Date(invite.createdAt).toLocaleString()}</td><td>{new Date(invite.expiresAt).toLocaleString()}</td><td>{invite.status}</td><td>{invite.status === 'pending' && <button disabled={busy} onClick={() => void action(`admin/invitations/${invite.id}/revoke`, {}, 'Invitation revoked.')}>Revoke invitation</button>}</td></tr>)}</tbody></table></div>}
    <h3 className="library-detail-title">Listeners</h3><div className="track-list"><table><thead><tr><th>Account</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td>{user.username}<small>Joined {new Date(user.createdAt).toLocaleDateString()}</small></td><td>{user.role}</td><td>{user.status}</td><td>{user.id !== state?.user?.id && user.status === 'active' && <><button disabled={busy} onClick={() => void action(`admin/users/${user.id}/revoke-sessions`, {}, 'Sessions revoked.')}>Revoke sessions</button>{user.role !== 'admin' && <button disabled={busy} onClick={() => void action(`admin/users/${user.id}/disable`, {}, 'Account disabled and sessions revoked.')}>Disable account</button>}</>}</td></tr>)}</tbody></table></div>
  </section>;
}
