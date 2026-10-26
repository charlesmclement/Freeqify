import {rememberOfflineAccount,forgetOfflineAccount,offlineAccount,deviceSignoutPending,setDeviceSignout} from './offline-store.js';
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AuthState } from '@freeqify/shared';
import { accountRequest, validAuthState } from './auth-api.js';
interface AccountContext {
  state: AuthState | null; offline: boolean; loading: boolean; error: string; invitation: string;
  refresh: () => void; signedIn: (state: AuthState) => void; logout: () => Promise<void>;
}
const Context = createContext<AccountContext | null>(null);
export function useAccount() { const context = useContext(Context); if (!context) throw new Error('Account context missing'); return context; }
/** Standalone library/test views may render without the application account provider. */
export function useOptionalAccount() { return useContext(Context); }
export function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(null);
  const [offline,setOffline]=useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const checking=useRef(false);
  const [invitation] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('invite') ?? '');
  useEffect(() => {
    if (invitation) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, [invitation]);
  useEffect(() => {
    const controller = new AbortController();
    checking.current=true;
    const timeout = setTimeout(() => { controller.abort();checking.current=false;const user=offlineAccount();if(user){setOffline(true);setState({user,csrf:'',expiresAt:0});setError('');}else setError('The account service took too long to respond.'); }, 10000);
    if(!navigator.onLine){const user=offlineAccount();if(user){checking.current=false;clearTimeout(timeout);queueMicrotask(()=>{if(!controller.signal.aborted){setOffline(true);setState({user,csrf:'',expiresAt:0});}});return ()=>{checking.current=false;controller.abort();};}}
    accountRequest<AuthState>('auth/session', undefined, undefined, controller.signal).then(async value => {
      if(deviceSignoutPending()&&validAuthState(value)){if(value.user)await accountRequest('auth/logout',value.csrf,{},controller.signal);setDeviceSignout(false);value=await accountRequest<AuthState>('auth/session',undefined,undefined,controller.signal);}
      if (!validAuthState(value)) throw new Error('The account service returned an invalid response.');
      if (!controller.signal.aborted) {setOffline(false);setError('');setState(value);if(value.user)rememberOfflineAccount(value.user);else forgetOfflineAccount();}
    }).catch(() => { if (!controller.signal.aborted) {const user=offlineAccount();if(user){setOffline(true);setState({user,csrf:'',expiresAt:0});setError('');}else setError('The account service is unavailable. Please try again.');} }).finally(() => {checking.current=false;clearTimeout(timeout);});
    return () => { checking.current=false;controller.abort(); clearTimeout(timeout); };
  }, [revision]);
  function refresh() { setError('');setRevision(n => n + 1); }
  useEffect(() => {
    const invalidated = () => { forgetOfflineAccount();setOffline(false);setState(null); setError(''); setRevision(n => n + 1); };
    const refreshed = (event: Event) => { const value = (event as CustomEvent<AuthState>).detail; if (validAuthState(value)) {setOffline(false);setState(value);if(value.user)rememberOfflineAccount(value.user);else forgetOfflineAccount();} };
    window.addEventListener('freeqify:session-refreshed', refreshed);
    window.addEventListener('freeqify:unauthenticated', invalidated);
    return () => { window.removeEventListener('freeqify:unauthenticated', invalidated); window.removeEventListener('freeqify:session-refreshed', refreshed); };
  }, []);
  useEffect(()=>{
    if(!offline&&!error&&!deviceSignoutPending())return;
    const reconnect=()=>{if(navigator.onLine&&!checking.current)setRevision(n=>n+1);};
    const visible=()=>{if(document.visibilityState==='visible')reconnect();};
    const timer=setInterval(reconnect,5000);
    window.addEventListener('online',reconnect);window.addEventListener('focus',reconnect);document.addEventListener('visibilitychange',visible);
    return()=>{clearInterval(timer);window.removeEventListener('online',reconnect);window.removeEventListener('focus',reconnect);document.removeEventListener('visibilitychange',visible);};
  },[offline,error,revision]);
  function signedIn(value:AuthState){setDeviceSignout(false);setOffline(false);setState(value);if(value.user)rememberOfflineAccount(value.user);}
  useEffect(()=>{const disconnected=()=>{if(state?.user&&!offline){rememberOfflineAccount(state.user);setOffline(true);setState({user:{...state.user,role:'listener'},csrf:'',expiresAt:0});}};window.addEventListener('offline',disconnected);window.addEventListener('freeqify:server-unavailable',disconnected);return()=>{window.removeEventListener('offline',disconnected);window.removeEventListener('freeqify:server-unavailable',disconnected);};},[state,offline]);
  async function logout() {
    if (!state) return;
    window.dispatchEvent(new Event('freeqify:logout'));
    if(offline)setDeviceSignout(true);else{await accountRequest('auth/logout', state.csrf, {});setDeviceSignout(false);}
    forgetOfflineAccount();setOffline(false);setState(null);setError('');setRevision(n=>n+1);
  }
  return <Context value={{ state, offline, loading: !state && !error, error, invitation, refresh, signedIn, logout }}>{children}</Context>;
}
export function SignInPanel() {
  const account = useAccount();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (account.loading) return <p className="library-message" role="status">Checking your private session…</p>;
  if (account.error) return <div className="library-message" role="alert">{account.error}<button onClick={account.refresh}>Try account connection again</button></div>;
  async function checkInvitation() {
    setBusy(true); setError('');
    try { await accountRequest('auth/invitation', account.state!.csrf, { token: account.invitation }); setAccepted(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The invitation is unavailable.'); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (accepted && password !== confirmation) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const result = await accountRequest<AuthState>(accepted ? 'auth/accept-invitation' : 'auth/login', account.state!.csrf, { username, password, ...(accepted ? { token: account.invitation } : {}) });
      setPassword(''); setConfirmation(''); account.signedIn(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to sign in.'); setPassword(''); setConfirmation(''); }
    finally { setBusy(false); }
  }
  return <section className="account-panel" aria-labelledby="account-heading"><span className="eyebrow">YOUR PRIVATE MUSIC SPACE</span>
    <h2 id="account-heading">{account.invitation ? accepted ? 'Create your account' : 'You’re invited to Freeqify' : 'Welcome back. Find your frequency.'}</h2>
    <p>{account.invitation ? 'A private invitation, a place for your music.' : 'Sign in to explore the collection. New accounts need an administrator’s invitation.'}</p>
    {error && <p role="alert" className="account-error">{error}</p>}
    {account.invitation && !accepted ? <button className="account-primary" onClick={() => void checkInvitation()} disabled={busy}>{busy ? 'Checking invitation…' : 'Accept invitation'}</button>
      : <form onSubmit={submit} className="account-form"><label>Username<input name="username" autoComplete="username" required minLength={3} maxLength={32} value={username} onChange={event => setUsername(event.target.value)} /></label>
        <label>Password<input name="password" type="password" autoComplete={accepted ? 'new-password' : 'current-password'} required minLength={accepted ? 15 : 1} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
        {accepted && <><p className="account-hint">Use a password or passphrase of 15–128 characters.</p><label>Confirm password<input type="password" autoComplete="new-password" required maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label></>}
        <button className="account-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : accepted ? 'Create private account' : 'Sign in'}</button></form>}
    {!account.invitation && <p className="account-hint">First time on your own server? Create your administrator using the local setup command in the README.</p>}
  </section>;
}
function PasswordChange() {
 const account=useAccount();const [current,setCurrent]=useState('');const [replacement,setReplacement]=useState('');const [confirmation,setConfirmation]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 return <details><summary>Change password</summary><form className="account-form" onSubmit={event=>{
  event.preventDefault();if(replacement!==confirmation){setError('Passwords do not match.');return;}setBusy(true);setError('');
  void accountRequest('auth/password',account.state!.csrf,{currentPassword:current,newPassword:replacement})
   .then(()=>{window.dispatchEvent(new Event('freeqify:logout'));account.refresh();})
   .catch(reason=>setError(reason instanceof Error?reason.message:'Could not change password.'))
   .finally(()=>{setCurrent('');setReplacement('');setConfirmation('');setBusy(false);});
 }}><label>Current password<input type="password" autoComplete="current-password" required maxLength={128} value={current} onChange={e=>setCurrent(e.target.value)}/></label>
 <label>New password<input type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={replacement} onChange={e=>setReplacement(e.target.value)}/></label>
 <label>Confirm new password<input type="password" autoComplete="new-password" required maxLength={128} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
 <p className="account-hint">Use a unique passphrase of 15–128 characters. Changing it signs out all your sessions.</p>
 {error&&<p role="alert">{error}</p>}<button disabled={busy}>Save password and sign out</button></form></details>;
}
export function ProfileMenu({ openAdmin }: { openAdmin: () => void }) {
  const { state, logout, offline } = useAccount(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  if (!state?.user) return null;
  return <details className="profile-menu"><summary>{state.user.username} <span aria-hidden="true">⌄</span></summary><div className="profile-content"><strong>{state.user.username}</strong><p>{state.user.role === 'admin' ? 'Administrator' : 'Listener'}</p><small>Joined {new Date(state.user.createdAt).toLocaleDateString()}</small>
    {state.user.role === 'admin' && <button onClick={openAdmin}>Manage invitations & users</button>}
    {!offline&&<PasswordChange/>}<button disabled={busy} onClick={() => { setBusy(true); void logout().catch(() => setError('Could not sign out. Try again.')).finally(() => setBusy(false)); }}>Sign out</button>{error && <p role="alert">{error}</p>}</div></details>;
}
