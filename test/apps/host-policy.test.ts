import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLoopbackHost, resolveListenHost } from '../../apps/shared/host-policy.js';
import { DefaultClientStore } from '../../src/auth/index.js';

test('host-policy: loopback detection', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('127.10.0.9'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('LOCALHOST'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('[::1]'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
  assert.equal(isLoopbackHost('::'), false);
  assert.equal(isLoopbackHost('192.168.1.5'), false);
  assert.equal(isLoopbackHost('my-laptop.local'), false);
  assert.equal(isLoopbackHost(''), false);
});

test('host-policy: default key active forces loopback', () => {
  const policy = resolveListenHost('0.0.0.0', true);
  assert.equal(policy.host, '127.0.0.1');
  assert.equal(policy.restricted, true);
  assert.equal(policy.requestedHost, '0.0.0.0');
});

test('host-policy: default key active keeps an already-loopback host', () => {
  const policy = resolveListenHost('127.0.0.1', true);
  assert.equal(policy.host, '127.0.0.1');
  assert.equal(policy.restricted, false);
});

test('host-policy: default key inactive allows an exposed host', () => {
  const policy = resolveListenHost('0.0.0.0', false);
  assert.equal(policy.host, '0.0.0.0');
  assert.equal(policy.restricted, false);
  assert.equal(policy.requestedHost, '0.0.0.0');
});

test('default client store: blank secret disables the key', () => {
  assert.equal(new DefaultClientStore({ secretKey: '' }).enabled, false);
  assert.equal(new DefaultClientStore({ secretKey: '   ' }).enabled, false);
  assert.equal(new DefaultClientStore({ secretKey: 's3cret' }).enabled, true);
  assert.equal(new DefaultClientStore().enabled, true);
});
