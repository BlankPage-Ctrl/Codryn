export interface CanonicalStringInput {
  method: string;
  path: string;
  queryString: string;
  timestamp: string;
  requestId?: string;
  bodyHash: string;
}

export function buildCanonicalString(input: CanonicalStringInput): string {
  const method = input.method.toUpperCase();
  const path = normalizePath(input.path);
  const sortedQuery = sortQueryString(input.queryString);

  return [method, path, sortedQuery, input.timestamp, input.requestId ?? '', input.bodyHash].join(
    '\n',
  );
}

function normalizePath(path: string): string {
  const qIdx = path.indexOf('?');
  if (qIdx !== -1) {
    path = path.slice(0, qIdx);
  }
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  return path;
}

function sortQueryString(queryString: string): string {
  if (!queryString) return '';

  const params = queryString.split('&').filter(Boolean);
  return params.sort((a, b) => a.localeCompare(b)).join('&');
}
