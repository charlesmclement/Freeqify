// @vitest-environment jsdom
import { afterEach,beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { App } from './App.js';
beforeEach(()=>{localStorage.clear();window.history.replaceState(null,'','/');});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('shows an honest foundation screen and connected server state', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok', service: 'freeqify', phase: 0 }) });
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => url.endsWith('/health') ? fetch(url, init) : url.endsWith('/auth/session') ? Promise.resolve({ ok: true, json: async () => ({ user: { id: 'test-user', username: 'listener', role: 'listener', status: 'active', createdAt: 0 }, csrf: 'a'.repeat(64), expiresAt: Date.now() + 3600000 }) }) : Promise.resolve({ ok: true, json: async () => ({ artists: 0, albums: 0, tracks: 0, scanning: false }) }));
  render(<App />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your Music.Your Frequency.');
  expect(await screen.findByText('Server connected')).toBeVisible();
  expect(fetch).toHaveBeenCalledWith('/api/health', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(screen.getByText(/Private accounts are here/)).toBeVisible();
  expect(await screen.findByLabelText('Visualizer mode')).toHaveValue('spectrum2d');
  expect(document.querySelector('#main')?.children[1]).toHaveClass('player-main-host');
  expect(document.querySelector('.hero')?.nextElementSibling?.tagName).toBe('FOOTER');
});
it('reports invalid responses and allows a successful retry', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok', service: 'freeqify', phase: 0 }) });
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => url.endsWith('/health') ? fetch(url, init) : url.endsWith('/auth/session') ? Promise.resolve({ ok: true, json: async () => ({ user: { id: 'test-user', username: 'listener', role: 'listener', status: 'active', createdAt: 0 }, csrf: 'a'.repeat(64), expiresAt: Date.now() + 3600000 }) }) : Promise.resolve({ ok: true, json: async () => ({ artists: 0, albums: 0, tracks: 0, scanning: false }) }));
  render(<App />);
  expect(await screen.findByText('Server unavailable')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  await waitFor(() => expect(screen.getByText('Server connected')).toBeVisible());
});
it('reports a network failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unavailable')));
  render(<App />);
  expect(await screen.findByText('Server unavailable')).toBeVisible();
});
