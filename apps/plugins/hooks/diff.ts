export type HookChangeOp = 'set' | 'remove';

export interface HookChange {
  /** JSON pointer (RFC 6901) of the changed leaf. */
  path: string;
  op: HookChangeOp;
  value?: unknown;
}

export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function pointerSegments(pointer: string): string[] {
  if (!pointer || pointer === '/') return [];
  return pointer.split('/').slice(1).map(unescapePointerSegment);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function diffValue(original: unknown, proposed: unknown, path: string, out: HookChange[]): void {
  if (Object.is(original, proposed)) return;

  if (isPlainObject(original) && isPlainObject(proposed)) {
    for (const key of Object.keys(proposed)) {
      const child = `${path}/${escapePointerSegment(key)}`;
      if (!(key in original)) {
        out.push({ path: child, op: 'set', value: proposed[key] });
        continue;
      }
      diffValue(original[key], proposed[key], child, out);
    }
    for (const key of Object.keys(original)) {
      if (!(key in proposed)) {
        out.push({ path: `${path}/${escapePointerSegment(key)}`, op: 'remove' });
      }
    }
    return;
  }

  if (Array.isArray(original) && Array.isArray(proposed)) {
    const length = Math.max(original.length, proposed.length);
    for (let index = 0; index < length; index += 1) {
      const child = `${path}/${index}`;
      if (index >= proposed.length) {
        out.push({ path: child, op: 'remove' });
        continue;
      }
      if (index >= original.length) {
        out.push({ path: child, op: 'set', value: proposed[index] });
        continue;
      }
      diffValue(original[index], proposed[index], child, out);
    }
    return;
  }

  out.push({ path, op: 'set', value: proposed });
}

/**
 * Changes a plugin proposed, limited to the writable roots Codryn allows.
 * The diff is computed by Codryn so a plugin cannot claim it touched less
 * than it did.
 */
export function diffPayload(
  original: unknown,
  proposed: unknown,
  writableRoots: string[],
): HookChange[] {
  if (writableRoots.length === 0) return [];
  if (!isPlainObject(original) || !isPlainObject(proposed)) return [];

  const changes: HookChange[] = [];
  for (const root of writableRoots) {
    const path = `/${escapePointerSegment(root)}`;
    if (!(root in proposed)) {
      if (root in original) changes.push({ path, op: 'remove' });
      continue;
    }
    if (!(root in original)) {
      changes.push({ path, op: 'set', value: proposed[root] });
      continue;
    }
    diffValue(original[root], proposed[root], path, changes);
  }
  return changes;
}

function resolveParent(
  root: unknown,
  segments: string[],
): Record<string, unknown> | unknown[] | null {
  let node: unknown = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[segments[index]];
  }
  if (node === null || typeof node !== 'object') return null;
  return node as Record<string, unknown> | unknown[];
}

function setAtPointer(root: unknown, segments: string[], value: unknown): void {
  let node: unknown = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (node === null || typeof node !== 'object') return;
    const key = segments[index];
    const child = (node as Record<string, unknown>)[key];
    if (child === null || typeof child !== 'object') {
      (node as Record<string, unknown>)[key] = /^\d+$/.test(segments[index + 1]) ? [] : {};
    }
    node = (node as Record<string, unknown>)[key];
  }
  if (node === null || typeof node !== 'object') return;
  const last = segments[segments.length - 1];
  if (Array.isArray(node)) {
    const index = Number(last);
    if (!Number.isInteger(index)) return;
    while (node.length < index) node.push(null);
    node[index] = value;
    return;
  }
  (node as Record<string, unknown>)[last] = value;
}

function removeAtPointer(root: unknown, segments: string[]): void {
  const parent = resolveParent(root, segments);
  if (!parent) return;
  const last = segments[segments.length - 1];
  if (Array.isArray(parent)) {
    const index = Number(last);
    if (Number.isInteger(index) && index >= 0 && index < parent.length) parent.splice(index, 1);
    return;
  }
  delete parent[last];
}

/** Applies changes to a copy of the payload; the snapshot stays untouched. */
export function applyChanges(payload: unknown, changes: HookChange[]): unknown {
  const next = structuredClone(payload);
  for (const change of changes) {
    const segments = pointerSegments(change.path);
    if (segments.length === 0) continue;
    if (change.op === 'remove') {
      removeAtPointer(next, segments);
      continue;
    }
    setAtPointer(next, segments, change.value);
  }
  return next;
}
