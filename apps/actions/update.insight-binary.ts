import type { Container } from '../bootstrap.js';
import { ensureInsightBinary, prodInsightDir } from '../insight/binary.js';
import type { InsightBinaryInfo } from '../insight/binary.js';
import { resolveInsightPinForUpdate } from '../insight/manifest.js';
import { assertInternetAvailable } from '../insight/network.js';
import { downloadInsightBinary, insightDownloadUrl } from '../insight/updater.js';
import { checkInsightUpdate } from './check.insight-update.js';

export interface UpdateInsightBinaryParams {
  codrynVersion: string;
  requestedVersion?: string;
  installDir?: string;
}

export interface UpdateInsightBinaryResult {
  codrynVersion: string;
  previous: string | null;
  installed: string;
  path: string;
  url: string;
}

/**
 * Resolve the manifest pin, decide the target, then download + install it.
 * Refuses explicit override/env binaries unless installDir is given (an
 * override means the user pinned the binary themselves; silently replacing
 * a different directory would be surprising).
 */
export async function updateInsightBinary(
  ctx: Pick<Container, 'logger'>,
  params: UpdateInsightBinaryParams,
): Promise<UpdateInsightBinaryResult> {
  await assertInternetAvailable();
  const resolved = await resolveInsightPinForUpdate({
    codrynVersion: params.codrynVersion,
  });

  let current: InsightBinaryInfo | null;
  try {
    current = await ensureInsightBinary({ logger: ctx.logger });
  } catch {
    current = null;
  }

  const decision = checkInsightUpdate({
    codrynVersion: params.codrynVersion,
    currentVersion: current?.version ?? null,
    resolved,
    requestedVersion: params.requestedVersion,
  });

  if (!decision.updateAvailable) {
    if (!current) {
      throw new Error('insight update: no binary installed and no target resolved');
    }
    ctx.logger?.info?.(
      { version: decision.current, target: decision.target },
      'insight binary already up to date, skipping download',
    );
    return {
      codrynVersion: decision.codrynVersion,
      previous: decision.current,
      installed: decision.current as string,
      path: current.path,
      url: insightDownloadUrl(decision.target),
    };
  }

  if (
    !params.installDir &&
    current &&
    (current.source === 'override' || current.source === 'env')
  ) {
    throw new Error(
      `insight update refused: current binary is pinned via ${current.source === 'override' ? 'explicit path' : '$INSIGHT_BINARY'} (${current.path}). Pass --dir to install elsewhere or unset the override.`,
    );
  }
  const installDir = params.installDir ?? current?.dir ?? prodInsightDir();
  const url = insightDownloadUrl(decision.target);
  ctx.logger?.info?.(
    { codrynVersion: decision.codrynVersion, from: decision.current, to: decision.target, url },
    'updating insight binary',
  );

  const downloaded = await downloadInsightBinary({
    version: decision.target,
    dir: installDir,
    logger: ctx.logger,
  });
  return {
    codrynVersion: decision.codrynVersion,
    previous: decision.current,
    installed: downloaded.version,
    path: downloaded.path,
    url: downloaded.url,
  };
}
