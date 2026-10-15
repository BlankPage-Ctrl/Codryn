import { INSIGHT_COMPAT_MIN } from '../insight/constants.js';
import { compareSemver, parseSemver } from '../insight/binary.js';
import { InsightBinaryError } from '../insight/execute/errors.js';
import type { InsightManifestPin } from '../insight/manifest.js';

export interface CheckInsightUpdateParams {
  codrynVersion: string;
  /** Null when no binary is installed or its version probe failed. */
  currentVersion: string | null;
  resolved: { pin: InsightManifestPin; codrynVersion: string };
  requestedVersion?: string;
}

export interface InsightUpdateDecision {
  codrynVersion: string;
  current: string | null;
  target: string;
  supported: string[];
  updateAvailable: boolean;
  alreadyLatest: boolean;
  incompatible: boolean;
  notes: string[];
}

/**
 * Pure update decision. The manifest pin decides the target (latest, or an
 * explicit supported version)
 */
export function checkInsightUpdate(params: CheckInsightUpdateParams): InsightUpdateDecision {
  const pin: InsightManifestPin = params.resolved.pin;
  const requested = params.requestedVersion?.trim().replace(/^v/, '');
  if (requested !== undefined && !parseSemver(requested)) {
    throw new InsightBinaryError(`insight update: invalid version "${params.requestedVersion}"`);
  }
  if (requested !== undefined && !pin.supported.includes(requested)) {
    throw new InsightBinaryError(
      `insight update refused: v${requested} is not supported for Codryn v${params.resolved.codrynVersion} (supported: ${pin.supported.map((v) => `v${v}`).join(', ')})`,
    );
  }
  const target = requested ?? pin.latest;
  if (compareSemver(target, INSIGHT_COMPAT_MIN) < 0) {
    throw new InsightBinaryError(
      `insight update refused: v${target} is below the minimum v${INSIGHT_COMPAT_MIN}`,
    );
  }

  const notes: string[] = [];
  const current = params.currentVersion?.trim().replace(/^v/, '') ?? null;
  if (current !== null && !parseSemver(current)) {
    throw new InsightBinaryError(
      `insight update: invalid current version "${params.currentVersion}"`,
    );
  }

  const incompatible = current !== null && compareSemver(current, INSIGHT_COMPAT_MIN) < 0;
  if (incompatible) {
    notes.push(`installed v${current} is below the minimum v${INSIGHT_COMPAT_MIN}`);
  }

  let updateAvailable: boolean;
  let alreadyLatest: boolean;
  if (current === null) {
    updateAvailable = true;
    alreadyLatest = false;
    notes.push('no insight binary version detected');
  } else {
    const cmp = compareSemver(current, target);
    if (cmp === 0) {
      updateAvailable = false;
      alreadyLatest = true;
    } else if (cmp < 0) {
      updateAvailable = true;
      alreadyLatest = false;
    } else {
      updateAvailable = false;
      alreadyLatest = false;
      notes.push(`installed v${current} is ahead of target v${target}`);
    }
  }

  return {
    codrynVersion: params.resolved.codrynVersion,
    current,
    target,
    supported: pin.supported,
    updateAvailable,
    alreadyLatest,
    incompatible,
    notes,
  };
}
