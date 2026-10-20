// @vitest-environment jsdom
import { afterEach,beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { App } from './App.js';
const account = { id: 'owner-id', username: 'owner', role: 'admin', status: 'active', createdAt: 0 };
const anonymous = { user: null, csrf: 'a'.repeat(64), expiresAt: Date.now() + 3600000 };
function response(value: unknown, ok = true, status = 200) { return { ok, status, json: async () => value }; }
beforeEach(()=>{localStorage.clear();window.history.replaceState(null,'','/');});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
function setup(overrides: Record<string, unknown> = {}, user: typeof account | null = null) {
  const fetcher = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
    const path = url.replace('/api/', '');
    if (path === 'health') return response({ status: 'ok', service: 'freeqify', phase: 0 });
    if (path === 'auth/session') return response({ ...anonymous, user });
    if (path in overrides) return response(overrides[path]);
    if (path === 'auth/login') return response({ ...anonymous, user: account });
    if (path === 'library/overview') return response({ artists: 1, albums: 1, tracks: 24, scanning: false });
    if (path === 'auth/logout') { user = null; return response({ ok: true }); }
    if (path === 'admin/invitations') return options?.method === 'POST' ? response({ id: 'invite-id', token: 'invite-secret', expiresAt: Date.now() + 3600000 }) : response({ items: [] });
    if (path === 'admin/users') return response({ items: [account] });
    return response({ error: { code: 'UNAVAILABLE', message: 'Unavailable' } }, false, 503);
  });
  vi.stubGlobal('fetch', fetcher); render(<App />); return fetcher;
}
it('shows the approved hero and login form without fetching private library data', async () => {
  const fetcher = setup();
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your Music.Your Frequency.');
  expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/library/'))).toBe(false);
  expect(screen.queryByRole('button', { name: /sign up/i })).not.toBeInTheDocument();
});
it('signs in with CSRF protection and then renders the existing music collection', async () => {
  const fetcher = setup();
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'owner' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-private-test-passphrase' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('24')).toBeVisible();
  const call = fetcher.mock.calls.find(([url]) => String(url).endsWith('/auth/login'))!;
  expect(call[1]).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': anonymous.csrf } });
});
it('checks a fragment invitation, removes it from the address, and allows account creation only afterward', async () => {
  window.history.replaceState(null, '', '/#invite=private-invitation-token');
  const fetcher = setup({ 'auth/invitation': { expiresAt: Date.now() + 3600000 }, 'auth/accept-invitation': { ...anonymous, user: { ...account, role: 'listener' } } });
  fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }));
  expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeVisible();
  expect(window.location.hash).toBe('');
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'listener' } });
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'a-private-test-passphrase' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-private-test-passphrase' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create private account' }));
  expect(await screen.findByText('24')).toBeVisible();
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('private-invitation-token'))).toBe(false);
});
it('shows generic invalid-login errors and clears the password field', async () => {
  const fetcher = setup();
  await screen.findByLabelText('Username');
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => url.endsWith('/auth/login') ? response({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' } }, false, 401) : original(url, init));
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'owner' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'incorrect' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.');
  expect(screen.getByLabelText('Password')).toHaveValue('');
});
it('provides administrator invitations and a profile logout control', async () => {
  setup({}, account);
  fireEvent.click(await screen.findByText('owner', { selector: 'summary' }));
  fireEvent.click(screen.getByRole('button', { name: 'Manage invitations & users' }));
  expect(await screen.findByRole('heading', { name: 'Invitations & listeners' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  expect(await screen.findByLabelText('New invitation link (shown once)')).toHaveValue(`${window.location.origin}/#invite=invite-secret`);
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Invitations & listeners' })).not.toBeInTheDocument();
});
it('unmounts private views after session invalidation', async () => {
  const fetcher = setup({}, account); expect(await screen.findByText('24')).toBeVisible();
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => url.endsWith('/auth/session') ? response(anonymous) : original(url, init));
  fireEvent(window,new Event('freeqify:unauthenticated'));
  await waitFor(() => expect(screen.queryByText('24')).not.toBeInTheDocument());
});
it('changes a password using CSRF then returns to sign-in and clears private views',async()=>{
 const fetcher=setup({},account);await screen.findByText('24');const original=fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async(url:string,init?:RequestInit)=>{
  if(url.endsWith('/auth/password'))return response({ok:true});
  if(url.endsWith('/auth/session'))return response(anonymous);
  return original(url,init);
 });
 fireEvent.click(screen.getByText('owner',{selector:'summary'}));fireEvent.click(screen.getByText('Change password',{selector:'summary'}));
 fireEvent.change(screen.getByLabelText('Current password'),{target:{value:'cobalt walnut paper compass'}});fireEvent.change(screen.getByLabelText('New password'),{target:{value:'river quartz hammock cedar'}});fireEvent.change(screen.getByLabelText('Confirm new password'),{target:{value:'river quartz hammock cedar'}});fireEvent.click(screen.getByRole('button',{name:'Save password and sign out'}));
 expect(await screen.findByRole('button',{name:'Sign in'})).toBeVisible();expect(screen.queryByText('24')).not.toBeInTheDocument();
 const call=fetcher.mock.calls.find(([url])=>String(url).endsWith('/auth/password'))!;expect(call[1]).toMatchObject({method:'POST',headers:{'X-CSRF-Token':anonymous.csrf}});
});
