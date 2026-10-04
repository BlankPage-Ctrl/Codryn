import { sql, type SQL } from 'drizzle-orm';
import { settings } from '../schemas/settings.js';
import type { Condition, SettingsField, SettingsSort } from './settings-query.types.js';

function escapeLikeLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Convert wildcard pattern using * (= any sequence) and ? (= single char)
 * with escape \* \? \\ to SQL LIKE pattern with ESCAPE '\'.
 * Examples: "app.*" -> "app.%" , "a?c" -> "a_c", "a\\*b" -> "a*b"
 */
export function wildcardToLike(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      const next = pattern[i + 1];
      if (next === '*' || next === '?' || next === '\\') {
        // literal *, ?, or \
        out += escapeLikeLiteral(next);
        i++;
        continue;
      }
      // lone backslash -> treat as literal
      out += '\\\\';
      continue;
    }
    if (ch === '*') out += '%';
    else if (ch === '?') out += '_';
    else if (ch === '%') out += '\\%';
    else if (ch === '_') out += '\\_';
    else if (ch === '\\') out += '\\\\';
    else out += ch;
  }
  return out;
}

function escapeLikeParam(value: string): string {
  return escapeLikeLiteral(value);
}

function columnFor(field: SettingsField): SQL {
  switch (field) {
    case 'key':
      return sql`${settings.key}`;
    case 'value':
      return sql`${settings.value}`;
    case 'created_at':
      return sql`${settings.createdAt}`;
    case 'updated_at':
      return sql`${settings.updatedAt}`;
  }
}

function lengthExpr(field: SettingsField): SQL {
  const col = columnFor(field);
  return sql`LENGTH(${col})`;
}

function castAsReal(col: SQL): SQL {
  return sql`CAST(${col} AS REAL)`;
}

function buildLengthSQL(
  field: SettingsField,
  filter: Record<string, number | [number, number]>,
): SQL {
  const len = lengthExpr(field);
  const parts: SQL[] = [];
  if (filter.$eq !== undefined) parts.push(sql`${len} = ${filter.$eq as number}`);
  if (filter.$ne !== undefined) parts.push(sql`${len} != ${filter.$ne as number}`);
  if (filter.$gt !== undefined) parts.push(sql`${len} > ${filter.$gt as number}`);
  if (filter.$gte !== undefined) parts.push(sql`${len} >= ${filter.$gte as number}`);
  if (filter.$lt !== undefined) parts.push(sql`${len} < ${filter.$lt as number}`);
  if (filter.$lte !== undefined) parts.push(sql`${len} <= ${filter.$lte as number}`);
  if (filter.$between !== undefined) {
    const [a, b] = filter.$between as [number, number];
    parts.push(sql`${len} BETWEEN ${a} AND ${b}`);
  }
  if (parts.length === 0) return sql`1=1`;
  if (parts.length === 1) return parts[0];
  return sql`(${sql.join(parts, sql` AND `)})`;
}

function buildLeafSQL(
  field: SettingsField,
  op: Record<string, unknown>,
  caseInsensitive: boolean,
  asNumber: boolean,
): SQL {
  const col = columnFor(field);
  const lowerCol = sql`LOWER(${col})`;

  // helper to wrap case-insensitive
  const likeWithCase = (pattern: string): SQL => {
    const escaped = pattern;
    if (caseInsensitive) {
      return sql`${lowerCol} LIKE LOWER(${escaped}) ESCAPE '\\'`;
    }
    return sql`${col} LIKE ${escaped} ESCAPE '\\'`;
  };

  // $eq / $ne
  if ('$eq' in op) {
    const v = op.$eq as string | number;
    if (asNumber && typeof v === 'number') {
      return sql`${castAsReal(col)} = ${v}`;
    }
    if (caseInsensitive && typeof v === 'string') {
      return sql`${lowerCol} = LOWER(${v})`;
    }
    return sql`${col} = ${v}`;
  }
  if ('$ne' in op) {
    const v = op.$ne as string | number;
    if (asNumber && typeof v === 'number') {
      return sql`${castAsReal(col)} != ${v}`;
    }
    if (caseInsensitive && typeof v === 'string') {
      return sql`${lowerCol} != LOWER(${v as string})`;
    }
    return sql`${col} != ${v}`;
  }

  // $contains
  if ('$contains' in op) {
    const v = escapeLikeParam(op.$contains as string);
    const pattern = `%${v}%`;
    return likeWithCase(pattern);
  }
  if ('$startsWith' in op) {
    const v = escapeLikeParam(op.$startsWith as string);
    const pattern = `${v}%`;
    return likeWithCase(pattern);
  }
  if ('$endsWith' in op) {
    const v = escapeLikeParam(op.$endsWith as string);
    const pattern = `%${v}`;
    return likeWithCase(pattern);
  }
  if ('$wildcard' in op) {
    const pattern = wildcardToLike(op.$wildcard as string);
    return likeWithCase(pattern);
  }
  if ('$in' in op) {
    const arr = op.$in as string[];
    const values = caseInsensitive ? arr.map((s) => s.toLowerCase()) : arr;
    const list = sql.join(
      values.map((v) => sql`${v}`),
      sql`, `,
    );
    if (caseInsensitive) {
      return sql`${lowerCol} IN (${list})`;
    }
    return sql`${col} IN (${list})`;
  }
  if ('$nin' in op) {
    const arr = op.$nin as string[];
    const values = caseInsensitive ? arr.map((s) => s.toLowerCase()) : arr;
    const list = sql.join(
      values.map((v) => sql`${v}`),
      sql`, `,
    );
    if (caseInsensitive) {
      return sql`${lowerCol} NOT IN (${list})`;
    }
    return sql`${col} NOT IN (${list})`;
  }
  if ('$length' in op) {
    return buildLengthSQL(field, op.$length as Record<string, number | [number, number]>);
  }

  // Range ops: $gt, $gte, $lt, $lte, $between
  if ('$gt' in op) {
    const v = op.$gt as string | number;
    if (asNumber) return sql`${castAsReal(col)} > ${typeof v === 'number' ? v : Number(v)}`;
    return sql`${col} > ${v}`;
  }
  if ('$gte' in op) {
    const v = op.$gte as string | number;
    if (asNumber) return sql`${castAsReal(col)} >= ${typeof v === 'number' ? v : Number(v)}`;
    return sql`${col} >= ${v}`;
  }
  if ('$lt' in op) {
    const v = op.$lt as string | number;
    if (asNumber) return sql`${castAsReal(col)} < ${typeof v === 'number' ? v : Number(v)}`;
    return sql`${col} < ${v}`;
  }
  if ('$lte' in op) {
    const v = op.$lte as string | number;
    if (asNumber) return sql`${castAsReal(col)} <= ${typeof v === 'number' ? v : Number(v)}`;
    return sql`${col} <= ${v}`;
  }
  if ('$between' in op) {
    const [a, b] = op.$between as [string | number, string | number];
    if (asNumber) {
      return sql`${castAsReal(col)} BETWEEN ${typeof a === 'number' ? a : Number(a)} AND ${typeof b === 'number' ? b : Number(b)}`;
    }
    return sql`${col} BETWEEN ${a} AND ${b}`;
  }

  // fallback
  return sql`1=1`;
}

export function buildWhereSQL(condition?: Condition): SQL | undefined {
  if (!condition) return undefined;
  const obj = condition as Record<string, unknown>;

  if ('$and' in obj) {
    const arr = (obj.$and as Condition[]).map((c) => buildWhereSQL(c)).filter(Boolean) as SQL[];
    if (arr.length === 0) return undefined;
    if (arr.length === 1) return arr[0];
    return sql`(${sql.join(arr, sql` AND `)})`;
  }
  if ('$or' in obj) {
    const arr = (obj.$or as Condition[]).map((c) => buildWhereSQL(c)).filter(Boolean) as SQL[];
    if (arr.length === 0) return undefined;
    if (arr.length === 1) return arr[0];
    return sql`(${sql.join(arr, sql` OR `)})`;
  }
  if ('$not' in obj) {
    const inner = buildWhereSQL(obj.$not as Condition);
    if (!inner) return undefined;
    return sql`NOT (${inner})`;
  }

  // leaf
  const field = obj.field as SettingsField;
  const caseInsensitive = Boolean(obj.caseInsensitive);
  const asNumber = Boolean(obj.asNumber);

  // shorthand $eq / $ne
  if ('$eq' in obj && !('op' in obj)) {
    const v = obj.$eq as string | number;
    const col = columnFor(field);
    if (asNumber && typeof v === 'number') return sql`${castAsReal(col)} = ${v}`;
    if (caseInsensitive && typeof v === 'string') return sql`LOWER(${col}) = LOWER(${v})`;
    return sql`${col} = ${v}`;
  }
  if ('$ne' in obj && !('op' in obj)) {
    const v = obj.$ne as string | number;
    const col = columnFor(field);
    if (asNumber && typeof v === 'number') return sql`${castAsReal(col)} != ${v}`;
    if (caseInsensitive && typeof v === 'string') return sql`LOWER(${col}) != LOWER(${v})`;
    return sql`${col} != ${v}`;
  }

  if ('op' in obj) {
    const op = obj.op as Record<string, unknown>;
    return buildLeafSQL(field, op, caseInsensitive, asNumber);
  }

  return undefined;
}

export function buildOrderBySQL(sort?: SettingsSort[]): SQL | undefined {
  if (!sort || sort.length === 0) return undefined;
  const parts: SQL[] = sort.map((s) => {
    const col = columnFor(s.field);
    return s.direction === 'desc' ? sql`${col} DESC` : sql`${col} ASC`;
  });
  return sql.join(parts, sql`, `);
}
