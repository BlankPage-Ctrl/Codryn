import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkInsightUpdate } from '../../apps/actions/check.insight-update.js';
import { CODRYN_ISSUES_URL } from '../../apps/insight/constants.js';
import {
  InsightBinaryError,
  InsightUnregisteredVersionError,
} from '../../apps/insight/execute/errors.js';
import {
  InsightManifestSchema,
  resolveInsightPin,
  resolveInsightPinForUpdate,
  type InsightManifest,
} from '../../apps/insight/manifest.js';
import { assertInternetAvailable } from '../../apps/insight/network.js';
import {
  downloadInsightBinary,
  fetchInsightReleaseDigest,
  insightAssetName,
  insightDownloadUrl,
  insightReleaseTag,
} from '../../apps/insight/updater.js';

const manifest: InsightManifest = {
  manifestVersion: 1,
  updatedAt: '2026-10-15T00:00:00Z',
  pins: {
    '0.0.2': { latest: '0.1.2', supported: ['0.0.10', '0.1.2'] },
  },
};

const pin020 = { pin: resolveInsightPin(manifest, '0.0.2'), codrynVersion: '0.0.2' };

interface StubRoute {
  status?: number;
  json?: unknown;
  bytes?: Uint8Array;
  capture?: { url: string; init: unknown }[];
}

function stubFetch(routes: { manifest?: StubRoute; tags?: StubRoute; asset?: StubRoute }): {
  fetch: typeof fetch;
  calls: { url: string; init: unknown }[];
} {
  const calls: { url: string; init: unknown }[] = [];
  const fetch = (async (url: unknown, init: unknown) => {
    const u = String(url);
    calls.push({ url: u, init });
    const route = u.includes('manifest.json')
      ? routes.manifest
      : u.includes('/releases/tags/')
        ? routes.tags
        : routes.asset;
    if (!route) throw new Error(`unexpected fetch: ${u}`);
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(route.json),
      arrayBuffer: () => Promise.resolve(route.bytes ?? new Uint8Array()),
    };
  }) as unknown as typeof fetch;
  return { fetch, calls };
}

const fakeBytes = new TextEncoder().encode('fake-srcinsight-binary');
const fakeSha = createHash('sha256').update(fakeBytes).digest('hex');

function tagsRoute(sha: string = fakeSha) {
  return {
    json: {
      assets: [
        {
          name: 'srcinsight-v0.0.10-linux-amd64',
          digest: `sha256:${sha}`,
          size: fakeBytes.length,
          browser_download_url: 'https://example.invalid/srcinsight',
        },
      ],
    },
  };
}

const fakeVersionRunner = () =>
  Promise.resolve('srcinsight v0.0.10 (commit b2f638e, built 2026-09-27T11:51:35Z)\n');

test('manifest schema accepts latest + supported, rejects min/max/default keys', () => {
  assert.deepEqual(InsightManifestSchema.parse(manifest), manifest);
  assert.deepEqual(
    InsightManifestSchema.parse({ ...manifest, $comment: 'human note' }).$comment,
    'human note',
  );
  assert.throws(
    () =>
      InsightManifestSchema.parse({
        ...manifest,
        pins: { '0.0.2': { latest: '0.1.2', supported: ['0.1.2'], min: '0.0.10' } },
      }),
    Error,
  );
  assert.throws(
    () =>
      InsightManifestSchema.parse({
        ...manifest,
        default: { latest: '0.0.10', supported: ['0.0.10'] },
      }),
    /Unrecognized key/,
  );
  assert.throws(
    () =>
      InsightManifestSchema.parse({
        ...manifest,
        pins: { '0.0.2': { latest: '0.2.0', supported: ['0.0.10'] } },
      }),
    /latest must be one of supported/,
  );
});

test('resolveInsightPin matches exact, throws fail-loud when unregistered', () => {
  assert.equal(resolveInsightPin(manifest, '0.0.2').latest, '0.1.2');
  assert.equal(resolveInsightPin(manifest, '0.0.2+abc1234').latest, '0.1.2');
  assert.throws(() => resolveInsightPin(manifest, '9.9.9'), InsightUnregisteredVersionError);
  assert.throws(() => resolveInsightPin(manifest, '0.0.0-dev'), InsightUnregisteredVersionError);
});

test('unregistered error carries version and issue URL, in English', () => {
  const err = (() => {
    try {
      resolveInsightPin(manifest, '9.9.9');
    } catch (e) {
      return e;
    }
    throw new Error('must throw');
  })();
  assert.ok(err instanceof InsightUnregisteredVersionError);
  assert.equal(err.codrynVersion, '9.9.9');
  assert.match(err.message, /Codryn v9\.9\.9 is not registered/);
  assert.match(err.message, /nothing was installed/);
  assert.ok(err.message.includes(CODRYN_ISSUES_URL));
});

test('online pin resolver fetches live manifest, throws when unknown or unreachable', async () => {
  const { fetch } = stubFetch({ manifest: { json: manifest } });
  const resolved = await resolveInsightPinForUpdate({ codrynVersion: '0.0.2', fetchImpl: fetch });
  assert.equal(resolved.pin.latest, '0.1.2');
  assert.equal(resolved.codrynVersion, '0.0.2');

  await assert.rejects(
    resolveInsightPinForUpdate({ codrynVersion: '9.9.9', fetchImpl: fetch }),
    InsightUnregisteredVersionError,
  );

  const failing = stubFetch({ manifest: { status: 500, json: {} } });
  await assert.rejects(
    resolveInsightPinForUpdate({ codrynVersion: '0.0.2', fetchImpl: failing.fetch }),
    /HTTP 500/,
  );
});

test('assertInternetAvailable resolves on one host, fails loud on none', async () => {
  await assertInternetAvailable({
    hosts: ['unreachable.invalid'],
    lookupImpl: () => Promise.resolve({}),
  });
  await assert.rejects(
    assertInternetAvailable({
      hosts: ['a.invalid', 'b.invalid'],
      lookupImpl: () => Promise.reject(new Error('nope')),
    }),
    /requires an internet connection/,
  );
  await assert.rejects(
    assertInternetAvailable({
      hosts: ['hang.invalid'],
      timeoutMs: 50,
      lookupImpl: () => new Promise(() => {}),
    }),
    /requires an internet connection/,
  );
});

test('check: up to date when current equals latest', () => {
  const d = checkInsightUpdate({
    codrynVersion: '0.0.2',
    currentVersion: '0.1.2',
    resolved: pin020,
  });
  assert.equal(d.updateAvailable, false);
  assert.equal(d.alreadyLatest, true);
  assert.equal(d.target, '0.1.2');
});

test('check: update available when current is older than latest', () => {
  const d = checkInsightUpdate({
    codrynVersion: '0.0.2',
    currentVersion: '0.0.10',
    resolved: pin020,
  });
  assert.equal(d.updateAvailable, true);
  assert.equal(d.target, '0.1.2');
});

test('check: missing binary always needs the latest', () => {
  const d = checkInsightUpdate({
    codrynVersion: '0.0.2',
    currentVersion: null,
    resolved: pin020,
  });
  assert.equal(d.updateAvailable, true);
  assert.equal(d.target, '0.1.2');
});

test('check: installed below the compat floor is flagged incompatible', () => {
  const d = checkInsightUpdate({
    codrynVersion: '0.0.2',
    currentVersion: '0.0.9',
    resolved: pin020,
  });
  assert.equal(d.incompatible, true);
  assert.equal(d.updateAvailable, true);
});

test('check: explicit supported version is installable, unsupported is refused', () => {
  const ok = checkInsightUpdate({
    codrynVersion: '0.0.2',
    currentVersion: '0.1.2',
    resolved: pin020,
    requestedVersion: '0.0.10',
  });
  assert.equal(ok.target, '0.0.10');
  assert.throws(
    () =>
      checkInsightUpdate({
        codrynVersion: '0.0.2',
        currentVersion: '0.1.2',
        resolved: pin020,
        requestedVersion: '9.9.9',
      }),
    /not supported for Codryn v0\.0\.2/,
  );
});

test('check: below-minimum request is refused (downgrade under floor = incompatible)', () => {
  assert.throws(
    () =>
      checkInsightUpdate({
        codrynVersion: '0.0.2',
        currentVersion: '0.1.2',
        resolved: {
          pin: { latest: '0.0.10', supported: ['0.0.9', '0.0.10'] },
          codrynVersion: '0.0.2',
        },
        requestedVersion: '0.0.9',
      }),
    InsightBinaryError,
  );
});

test('digest: parses sha256, rejects missing asset and malformed digest', async () => {
  const { fetch } = stubFetch({ manifest: { json: manifest }, tags: tagsRoute() });
  const d = await fetchInsightReleaseDigest('0.0.10', {
    fetchImpl: fetch,
    target: { os: 'linux', arch: 'amd64', ext: '' },
  });
  assert.equal(d.sha256, fakeSha);
  assert.equal(d.size, fakeBytes.length);

  const noAsset = stubFetch({ manifest: { json: manifest }, tags: { json: { assets: [] } } });
  await assert.rejects(
    fetchInsightReleaseDigest('0.0.10', {
      fetchImpl: noAsset.fetch,
      target: { os: 'linux', arch: 'amd64', ext: '' },
    }),
    /no asset named/,
  );

  const badDigest = stubFetch({
    manifest: { json: manifest },
    tags: {
      json: {
        assets: [{ name: 'srcinsight-v0.0.10-linux-amd64', digest: 'md5:abc', size: 1 }],
      },
    },
  });
  await assert.rejects(
    fetchInsightReleaseDigest('0.0.10', {
      fetchImpl: badDigest.fetch,
      target: { os: 'linux', arch: 'amd64', ext: '' },
    }),
    /no usable sha256 digest/,
  );
});

test('digest: 403 hints at rate limit and GITHUB_TOKEN', async () => {
  const { fetch } = stubFetch({ manifest: { json: manifest }, tags: { status: 403, json: {} } });
  await assert.rejects(
    fetchInsightReleaseDigest('0.0.10', {
      fetchImpl: fetch,
      target: { os: 'linux', arch: 'amd64', ext: '' },
    }),
    /GITHUB_TOKEN/,
  );
});

test('digest: GITHUB_TOKEN is sent when provided', async () => {
  const { fetch, calls } = stubFetch({ manifest: { json: manifest }, tags: tagsRoute() });
  await fetchInsightReleaseDigest('0.0.10', {
    fetchImpl: fetch,
    env: { GITHUB_TOKEN: 'secret-token' } as NodeJS.ProcessEnv,
    target: { os: 'linux', arch: 'amd64', ext: '' },
  });
  const headers = calls[0].init as { headers: Record<string, string> };
  assert.equal(headers.headers.Authorization, 'Bearer secret-token');
});

test('updater: tag and asset naming follow the Makefile convention', () => {
  assert.equal(insightReleaseTag('0.0.10'), 'v.0.0.10');
  assert.equal(
    insightAssetName('0.0.10', { os: 'linux', arch: 'amd64', ext: '' }),
    'srcinsight-v0.0.10-linux-amd64',
  );
  assert.equal(
    insightAssetName('0.0.10', { os: 'windows', arch: 'amd64', ext: '.exe' }),
    'srcinsight-v0.0.10-windows-amd64.exe',
  );
  assert.equal(
    insightDownloadUrl('0.0.10', { os: 'linux', arch: 'amd64', ext: '' }),
    'https://github.com/BlankPage-Ctrl/SrcInsight/releases/download/v.0.0.10/srcinsight-v0.0.10-linux-amd64',
  );
});

test('download verifies sha256 before writing, refuses mismatch without a trace', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'insight-dl-'));
  try {
    const { fetch } = stubFetch({
      manifest: { json: manifest },
      tags: tagsRoute(),
      asset: { bytes: fakeBytes },
    });
    const got = await downloadInsightBinary({
      version: '0.0.10',
      dir,
      fetchImpl: fetch,
      versionRunner: fakeVersionRunner,
      target: { os: 'linux', arch: 'amd64', ext: '' },
    });
    assert.equal(got.version, '0.0.10');
    assert.ok(existsSync(join(dir, 'srcinsight-v0.0.10-linux-amd64')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const tampered = mkdtempSync(join(tmpdir(), 'insight-dl-tampered-'));
  try {
    const other = new TextEncoder().encode('tampered-binary');
    const { fetch } = stubFetch({
      manifest: { json: manifest },
      tags: tagsRoute(),
      asset: { bytes: other },
    });
    await assert.rejects(
      downloadInsightBinary({
        version: '0.0.10',
        dir: tampered,
        fetchImpl: fetch,
        versionRunner: fakeVersionRunner,
        target: { os: 'linux', arch: 'amd64', ext: '' },
      }),
      /checksum mismatch/,
    );
    assert.deepEqual(readdirSync(tampered), []);
  } finally {
    rmSync(tampered, { recursive: true, force: true });
  }
});

test('updater: refuses below-minimum versions before any download', async () => {
  await assert.rejects(
    downloadInsightBinary({
      version: '0.0.9',
      dir: '/tmp/codryn-never-created',
      fetchImpl: (() => {
        throw new Error('must not fetch');
      }) as unknown as typeof fetch,
    }),
    /below the minimum/,
  );
  await assert.rejects(
    downloadInsightBinary({
      version: 'bogus',
      dir: '/tmp/codryn-never-created',
    }),
    /invalid version/,
  );
});
