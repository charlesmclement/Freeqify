import type { LibraryErrorResponse } from '@freeqify/shared';
export const libraryUrl = (path: string) => `${import.meta.env.BASE_URL}api/library/${path}`;
export async function readLibrary<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(libraryUrl(path), { signal: AbortSignal.any([signal,AbortSignal.timeout(30000)]), credentials: 'same-origin' }).catch(error=>{if(!signal.aborted)window.dispatchEvent(new Event('freeqify:server-unavailable'));throw error;});
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event('freeqify:unauthenticated'));
      throw new Error('Your session has expired. Sign in to continue.');
    }
    let message = 'The library could not be loaded. Check the local music engine.';
    try {
      const body = await response.json() as LibraryErrorResponse;
      const allowed = ['NOT_CONFIGURED', 'INVALID_CREDENTIALS', 'UNAVAILABLE', 'MALFORMED_RESPONSE', 'NOT_FOUND', 'INVALID_REQUEST'];
      // Display only our bounded public error contract, never arbitrary upstream output.
      if (allowed.includes(body.error?.code)) message = body.error.message;
    } catch { /* A disconnected or non-JSON service still gets a useful state. */ }
    throw new Error(message);
  }
  return await response.json() as T;
}
