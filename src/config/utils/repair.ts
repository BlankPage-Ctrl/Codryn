import { copyFileSync, existsSync } from 'node:fs';

export interface ConfigRepairInfo {
  repaired: boolean;
  backupPath: string | null;
  fixedPaths: string[];
  created: boolean;
}

export function emptyRepairInfo(): ConfigRepairInfo {
  return { repaired: false, backupPath: null, fixedPaths: [], created: false };
}

export function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (val === null || val === undefined) return false;
  if (typeof val !== 'object' || Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

export function getByPath(root: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

export function setByPath(root: Record<string, unknown>, path: string[], value: unknown): void {
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const next = cur[key];
    if (!isPlainObject(next)) {
      const created: Record<string, unknown> = {};
      cur[key] = created;
      cur = created;
    } else {
      cur = next;
    }
  }
  cur[path[path.length - 1]] = value;
}

export function deleteByPath(root: Record<string, unknown>, path: string[]): void {
  let cur: Record<string, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[path[i]];
    if (!isPlainObject(next)) return;
    cur = next;
  }
  delete cur[path[path.length - 1]];
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

export function backupTimestamp(d = new Date()): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export function backupFile(fullPath: string): string {
  let backupPath = `${fullPath}.bak.${backupTimestamp()}`;
  let counter = 0;
  while (existsSync(backupPath)) {
    counter += 1;
    backupPath = `${fullPath}.bak.${backupTimestamp()}.${counter}`;
  }
  copyFileSync(fullPath, backupPath);
  return backupPath;
}

export function collectMissingPaths(
  defaults: Record<string, unknown>,
  raw: Record<string, unknown>,
  prefix = '',
  out: string[] = [],
): string[] {
  for (const key of Object.keys(defaults)) {
    const full = prefix === '' ? key : `${prefix}.${key}`;
    const defVal = defaults[key];
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      out.push(full);
      continue;
    }
    const rawVal = raw[key];
    if (isPlainObject(defVal) && isPlainObject(rawVal)) {
      collectMissingPaths(defVal, rawVal, full, out);
    } else if (!deepEqual(defVal, rawVal) && isPlainObject(defVal) && !isPlainObject(rawVal)) {
      out.push(full);
    }
  }
  return out;
}
