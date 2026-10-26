import type { AuthState } from '@freeqify/shared';
export class AccountRequestError extends Error { constructor(message: string, public status: number) { super(message); } }
const identities = new Map<string, string | null>();
function remember(value: unknown) {
  const state = value as AuthState;
  if (state && validAuthState(state)) {
    if (identities.size >= 16) identities.clear();
    identities.set(state.csrf, state.user?.id ?? null);
  }
}
export async function accountRequest<T>(path: string, csrf?: string, input?: unknown, signal?: AbortSignal, recovered = false): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/${path}`, {
    credentials: 'same-origin', signal: AbortSignal.any([AbortSignal.timeout(12000), ...(signal ? [signal] : [])]),
    ...(input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf ?? '' }, body: JSON.stringify(input) }),
  }).catch(error=>{if(!signal?.aborted)window.dispatchEvent(new Event('freeqify:server-unavailable'));throw error;});
  if (!response.ok) {
    let message = 'The account service is unavailable. Please try again.';
    let code = '';
    try { const value = await response.json(); code = value.error?.code ?? ''; if (typeof value.error?.message === 'string' && value.error.message.length < 300) message = value.error.message; } catch { /* Safe fallback. */ }
    // A second tab can rotate the shared cookie while this tab retains its CSRF.
    // Rejected CSRF writes have not run. Retry once, only for the same known identity.
    if (response.status === 403 && code === 'CSRF_REJECTED' && !recovered && csrf && identities.has(csrf)) {
      const identity = identities.get(csrf);
      const current = await accountRequest<AuthState>('auth/session', undefined, undefined, signal);
      if (validAuthState(current) && (current.user?.id ?? null) === identity && current.csrf !== csrf) {
        window.dispatchEvent(new CustomEvent('freeqify:session-refreshed', { detail: current }));
        return accountRequest<T>(path, current.csrf, input, signal, true);
      }
      window.dispatchEvent(new Event('freeqify:unauthenticated'));
    }
    if (response.status === 401 && !path.startsWith('auth/login')) window.dispatchEvent(new Event('freeqify:unauthenticated'));
    throw new AccountRequestError(message, response.status);
  }
  const value: unknown = await response.json();
  remember(value);
  return value as T;
}
export function validAuthState(value: AuthState): boolean {
  return typeof value.csrf === 'string' && /^[a-f0-9]{64}$/.test(value.csrf) && typeof value.expiresAt === 'number'
    && (value.user === null || (typeof value.user?.username === 'string' && ['admin', 'listener'].includes(value.user.role)));
}
