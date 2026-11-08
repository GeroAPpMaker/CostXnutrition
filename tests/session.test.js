// tests/session.test.js
// Integration tests for session lifecycle: create, join, dedup.
// Run: node --test tests/session.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uniqueNickname } from '../server/logic/dedup.js';

// ── Nickname dedup ────────────────────────────────────────────────────────────
test('uniqueNickname — returns requested name when no conflict', () => {
  const participants = new Map();
  assert.equal(uniqueNickname('Juan', participants), 'Juan');
});

test('uniqueNickname — appends _2 on first conflict', () => {
  const participants = new Map([
    ['id1', { nickname: 'Juan' }],
  ]);
  assert.equal(uniqueNickname('Juan', participants), 'Juan_2');
});

test('uniqueNickname — increments past _2 if also taken', () => {
  const participants = new Map([
    ['id1', { nickname: 'Juan' }],
    ['id2', { nickname: 'Juan_2' }],
  ]);
  assert.equal(uniqueNickname('Juan', participants), 'Juan_3');
});

test('uniqueNickname — case-insensitive dedup', () => {
  const participants = new Map([
    ['id1', { nickname: 'JUAN' }],
  ]);
  assert.equal(uniqueNickname('juan', participants), 'juan_2');
});

test('uniqueNickname — trims whitespace', () => {
  const participants = new Map();
  assert.equal(uniqueNickname('  Ana  ', participants), 'Ana');
});

// ── Storage module ────────────────────────────────────────────────────────────
test('storage — set and get a session', async () => {
  const { setSession, getSession, deleteSession } = await import('../server/storage/index.js');
  setSession('TEST1', { code: 'TEST1', phase: 'LOBBY' });
  const s = getSession('TEST1');
  assert.equal(s.code, 'TEST1');
  assert.equal(s.phase, 'LOBBY');
  deleteSession('TEST1');
  assert.equal(getSession('TEST1'), null);
});

test('storage — getSession returns null for unknown code', async () => {
  const { getSession } = await import('../server/storage/index.js');
  assert.equal(getSession('NOPE99'), null);
});
