import { createInterface } from 'node:readline/promises';
import type { Command } from 'commander';
import { checkInsightUpdate } from '../../actions/check.insight-update.js';
import { updateInsightBinary } from '../../actions/update.insight-binary.js';
import { ensureInsightBinary } from '../../insight/binary.js';
import { resolveInsightPinForUpdate } from '../../insight/manifest.js';
import { assertInternetAvailable } from '../../insight/network.js';
import { getVersion } from '../../shared/version.js';
import { validateInsightUpdateOptions } from '../../validators/insight.js';
import { ensureCliLogger } from '../logging.js';
import type { CommandDeps } from './index.js';

function writeData(data: unknown, desc: string): void {
  process.stdout.write(`${JSON.stringify({ desc, data }, null, 2)}\n`);
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

export function registerUpdateCommands(parent: Command, deps: CommandDeps): void {
  const update = parent.command('update').description('Update Codryn components');

  update
    .command('srcinsight')
    .description(
      'Check and install the SrcInsight version pinned for this Codryn version',
    )
    .option('--check', 'Only check for updates, do not download')
    .option('--yes, -y', 'Skip the confirmation prompt')
    .option('--to <ver>', 'Install a specific supported version')
    .option('--dir <dir>', 'Install directory (default: ~/.codryn/backend/bin/insight/)')
    .action(async (opts) => {
      try {
        await runUpdateSrcinsight(deps, parent, opts);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`error: ${message}\n`);
        process.exitCode = 1;
      }
    });
}

async function runUpdateSrcinsight(
  deps: CommandDeps,
  parent: Command,
  opts: Record<string, unknown>,
): Promise<void> {
  const parsed = validateInsightUpdateOptions(opts);
  const config = deps.resolveConfig(parent.opts());
  const logger = ensureCliLogger(config);
  const codrynVersion = getVersion();
  await assertInternetAvailable();
  const resolved = await resolveInsightPinForUpdate({ codrynVersion });

  let currentVersion: string | null;
  try {
    const current = await ensureInsightBinary({ logger });
    currentVersion = current.version;
  } catch {
    currentVersion = null;
  }

  const decision = checkInsightUpdate({
    codrynVersion,
    currentVersion,
    resolved,
    requestedVersion: parsed.to,
  });

  const summary = {
    codryn: `v${decision.codrynVersion}`,
    current: decision.current ? `v${decision.current}` : 'not installed',
    target: `v${decision.target}`,
    supported: decision.supported.map((v) => `v${v}`),
    updateAvailable: decision.updateAvailable,
    notes: decision.notes,
  };

  if (parsed.check || !decision.updateAvailable) {
    writeData(
      summary,
      decision.updateAvailable
        ? `Update available: SrcInsight v${decision.current} -> v${decision.target} (Codryn v${decision.codrynVersion}).`
        : decision.alreadyLatest
          ? `SrcInsight v${decision.target} is already the latest for Codryn v${decision.codrynVersion}.`
          : `SrcInsight v${decision.current} is ahead of the manifest target v${decision.target}.`,
    );
    process.exitCode = decision.updateAvailable ? 2 : 0;
    return;
  }

  if (!parsed.yes) {
    const ok = await confirm(
      `Update SrcInsight v${decision.current ?? 'unknown'} -> v${decision.target} for Codryn v${decision.codrynVersion}?`,
    );
    if (!ok) {
      writeData(summary, 'Update cancelled.');
      return;
    }
  }

  const result = await updateInsightBinary(
    { logger },
    {
      codrynVersion,
      requestedVersion: parsed.to,
      installDir: parsed.dir,
    },
  );
  logger.info(
    { from: result.previous, to: result.installed, path: result.path },
    'insight binary updated via CLI',
  );
  writeData(
    {
      codryn: `v${result.codrynVersion}`,
      previous: result.previous ? `v${result.previous}` : 'not installed',
      installed: `v${result.installed}`,
      path: result.path,
    },
    `SrcInsight updated to v${result.installed}. Restart the backend so the new binary takes effect.`,
  );
}
