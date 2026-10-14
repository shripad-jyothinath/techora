import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AUTH_FILE, CREDS } from './helpers.js';

/**
 * Runs once before all specs: creates (or logs into) the test admin account
 * on the isolated test database and stores the session for every spec.
 */
setup('authenticate', async ({ request }) => {
  let res = await request.post('/api/auth/signup', { data: CREDS });
  if (res.status() === 409) {
    res = await request.post('/api/auth/login', {
      data: { username: CREDS.username, password: CREDS.password },
    });
  }
  expect(res.ok(), `auth setup failed: ${res.status()} ${await res.text()}`).toBeTruthy();

  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  await request.storageState({ path: AUTH_FILE });
});
