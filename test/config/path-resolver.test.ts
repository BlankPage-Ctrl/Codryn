import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import {
  BACKEND_DIR_NAME,
  CODRYN_DIR_NAME,
  isDevMode,
  resolveBackendBasePath,
  resolveCodrynHome,
  resolveConfigBasePath,
  resolveDatabasePath,
} from '../../src/config/index.js';

test('isDevMode: APP_ENV=development treats as dev', () => {
  assert.equal(isDevMode({ env: { APP_ENV: 'development' } }), true);
});

test('isDevMode: APP_ENV=prod treats as prod', () => {
  assert.equal(isDevMode({ env: { APP_ENV: 'prod' } }), false);
});

test('isDevMode: APP_MODE alias works', () => {
  assert.equal(isDevMode({ env: { APP_MODE: 'dev' } }), true);
  assert.equal(isDevMode({ env: { APP_MODE: 'production' } }), false);
});

test('isDevMode: falls back to NODE_ENV !== production', () => {
  assert.equal(isDevMode({ env: { NODE_ENV: 'test' } }), true);
  assert.equal(isDevMode({ env: { NODE_ENV: 'production' } }), false);
  assert.equal(isDevMode({ env: {} }), true);
});

test('resolveCodrynHome: always ~/.codryn regardless of env', () => {
  assert.equal(resolveCodrynHome({ home: '/home/u' }), join('/home/u', CODRYN_DIR_NAME));
  assert.equal(resolveCodrynHome({ home: '/home/u' }), join('/home/u', CODRYN_DIR_NAME));
});

test('resolveBackendBasePath: ~/.codryn/backend', () => {
  assert.equal(resolveBackendBasePath({ home: '/home/u' }), join('/home/u', CODRYN_DIR_NAME, BACKEND_DIR_NAME));
  assert.equal(BACKEND_DIR_NAME, 'backend');
});

test('resolveConfigBasePath: dev mode writes to cwd (project root)', () => {
  assert.equal(
    resolveConfigBasePath({ cwd: '/project', home: '/home/u', env: { APP_ENV: 'development' } }),
    '/project',
  );
  assert.equal(resolveConfigBasePath({ cwd: '/project', home: '/home/u', env: {} }), '/project');
});

test('resolveConfigBasePath: production goes to ~/.codryn/backend', () => {
  assert.equal(
    resolveConfigBasePath({ cwd: '/project', home: '/home/u', env: { APP_ENV: 'production' } }),
    join('/home/u', CODRYN_DIR_NAME, BACKEND_DIR_NAME),
  );
  assert.equal(
    resolveConfigBasePath({ cwd: '/project', home: '/home/u', env: { NODE_ENV: 'production' } }),
    join('/home/u', CODRYN_DIR_NAME, BACKEND_DIR_NAME),
  );
});

test('resolveDatabasePath: legacy file: prefix is stripped to a plain path', () => {
  assert.equal(resolveDatabasePath('file:data.db', '/base'), join('/base', 'data.db'));
});

test('resolveDatabasePath: plain relative path resolved against basePath', () => {
  assert.equal(resolveDatabasePath('data.db', '/base'), join('/base', 'data.db'));
});

test('resolveDatabasePath: leaves :memory: untouched', () => {
  assert.equal(resolveDatabasePath(':memory:', '/base'), ':memory:');
});

test('resolveDatabasePath: rejects remote URLs', () => {
  assert.throws(
    () => resolveDatabasePath('libsql://my-db.turso.io', '/base'),
    /Remote database URLs are not supported/,
  );
});

test('resolveDatabasePath: leaves absolute paths untouched', () => {
  assert.equal(resolveDatabasePath('file:/opt/app/data.db', '/base'), '/opt/app/data.db');
  assert.equal(resolveDatabasePath('C:\\data\\app.db', '/base'), 'C:\\data\\app.db');
});
