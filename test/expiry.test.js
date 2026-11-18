import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { open } from '../src/db.js';
import { createApp } from '../src/app.js';

let server;
let base;

before(async () => {
  const db = open(':memory:');
  const migration = (name) => fileURLToPath(new URL(`../migrations/${name}`, import.meta.url));
  db.exec(readFileSync(migration('001_init.up.sql'), 'utf8'));
  db.exec(readFileSync(migration('002_expiry.up.sql'), 'utf8'));
  server = createApp(db, {
    version: '2.0.0',
    env: 'test',
    baseUrl: 'http://short.test',
    adminToken: 'test-token',
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const request = (path, init = {}) => fetch(`${base}${path}`, {
  ...init,
  headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
});
const post = (body) => request('/links', { method: 'POST', body: JSON.stringify(body) });
const setExpiry = (enabled) => request('/admin/flags/expiry', {
  method: 'PUT',
  headers: { 'x-admin-token': 'test-token' },
  body: JSON.stringify({ enabled }),
});

test('expiry is ignored while the flag is off', async () => {
  const response = await post({ url: 'https://example.com/off', expiresInSeconds: 1 });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.expiresAt, null);
});

test('expiry flag validates and expires links', async () => {
  assert.equal((await setExpiry(true)).status, 200);
  assert.equal((await post({ url: 'https://example.com/bad', expiresInSeconds: 0 })).status, 400);

  const created = await (await post({ url: 'https://example.com/soon', expiresInSeconds: 1 })).json();
  assert.equal(typeof created.expiresAt, 'string');
  assert.equal((await request(`/r/${created.code}`, { redirect: 'manual' })).status, 302);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const expired = await request(`/r/${created.code}`);
  assert.equal(expired.status, 410);
  assert.deepEqual(await expired.json(), { error: 'expired', message: 'link has expired' });
});
