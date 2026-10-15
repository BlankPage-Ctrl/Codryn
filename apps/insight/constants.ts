import { join } from 'node:path';

export const INSIGHT_DIR_REL = join('.codryn', 'insight');
export const INSIGHT_DB_NAME = 'insight.db';
export const INSIGHT_SETTING_SUFFIX = 'insight';

export const INSIGHT_DEFAULT_ENABLED = false;

export const INSIGHT_BINARY_ENV = 'INSIGHT_BINARY';
export const INSIGHT_BINARY_FALLBACK = 'srcinsight/srcinsight';

/** Unversioned binary name (versioned variants look like `srcinsight-v0.0.10-linux-amd64`). */
export const INSIGHT_BINARY_NAME = 'srcinsight';
/** Dev checkout layout: `<repo>/packages/backend/srcinsight/`. */
export const INSIGHT_DEV_DIR_NAME = 'srcinsight';
/** Prod bundle layout (all OSes, incl. Windows): `~/.codryn/backend/bin/insight/`. */
export const INSIGHT_PROD_DIR_PARTS = ['.codryn', 'backend', 'bin', 'insight'] as const;

export const INSIGHT_COMPAT_MIN = '0.0.10';
export const INSIGHT_COMPAT_MAX: string | undefined = undefined;

/** Timeout for `<binary> version` probe. */
export const INSIGHT_VERSION_TIMEOUT_MS = 8000;

/** Timeout for the SrcInsight binary download (12MB+ asset, slow links). */
export const INSIGHT_DOWNLOAD_TIMEOUT_MS = 120_000;

/** Where users report an unregistered Codryn version (no manifest pin). */
export const CODRYN_ISSUES_URL = 'https://github.com/BlankPage-Ctrl/Codryn/issues/new';
