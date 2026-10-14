import { request, test, expect } from '@playwright/test';
import { CREDS } from './helpers.js';

/**
 * Auth contract: public endpoints, the gate, signup validation, session
 * lifecycle. These tests run WITHOUT the stored session.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test('public endpoints stay open, protected ones do not', async ({ request }) => {
  expect((await request.get('/api/health')).ok()).toBeTruthy();
  const status = await request.get('/api/auth/status');
  expect(status.ok()).toBeTruthy();
  expect((await status.json()).users).toBeGreaterThanOrEqual(1);

  for (const path of ['/api/invoices', '/api/dashboard', '/api/meta', '/api/stock-levels', '/api/search?q=x']) {
    expect((await request.get(path)).status(), path).toBe(401);
  }
});

test('signup validates username and password rules', async ({ request }) => {
  expect((await request.post('/api/auth/signup', { data: { username: 'ab', password: 'longenough' } })).status()).toBe(400);
  expect((await request.post('/api/auth/signup', { data: { username: 'validname', password: 'short' } })).status()).toBe(400);
});

test('duplicate usernames are rejected', async ({ request }) => {
  const res = await request.post('/api/auth/signup', { data: { ...CREDS, name: 'Duplicate attempt' } });
  expect(res.status()).toBe(409);
});

test('wrong password rejected; right password opens a session; logout closes it', async ({ baseURL }) => {
  const ctx = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });

  const bad = await ctx.post('/api/auth/login', { data: { username: CREDS.username, password: 'not-the-password' } });
  expect(bad.status()).toBe(401);

  const ok = await ctx.post('/api/auth/login', { data: { username: CREDS.username, password: CREDS.password } });
  expect(ok.ok()).toBeTruthy();
  const me = await ctx.get('/api/auth/me');
  expect(me.ok()).toBeTruthy();
  expect((await me.json()).user.username).toBe(CREDS.username);

  expect((await ctx.post('/api/auth/logout')).ok()).toBeTruthy();
  expect((await ctx.get('/api/auth/me')).status()).toBe(401);
  expect((await ctx.get('/api/invoices')).status()).toBe(401);

  await ctx.dispose();
});

test('malformed JSON bodies are client errors, not crashes', async ({ request }) => {
  const res = await request.post('/api/auth/login', {
    headers: { 'content-type': 'application/json' },
    data: '{this is not json',
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toMatch(/Invalid JSON/i);
});
