export type ContentRoute = 'html' | 'json' | 'xml' | 'text' | 'pdf' | 'image' | 'binary';

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const JSON_TYPES = new Set(['application/json', 'text/json']);
const XML_TYPES = new Set(['application/xml', 'text/xml']);
const TEXT_TYPES = new Set([
  'text/plain',
  'text/css',
  'text/csv',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
  'application/x-httpd-php-source',
  'application/sql',
  'application/graphql',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
]);

export function mediaType(contentType: string): string {
  const head = contentType.split(';')[0].trim().toLowerCase();
  return head;
}

export function routeContentType(contentType: string): ContentRoute {
  const type = mediaType(contentType);
  if (type === '') return 'binary';
  if (HTML_TYPES.has(type)) return 'html';
  if (JSON_TYPES.has(type)) return 'json';
  if (XML_TYPES.has(type)) return 'xml';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('image/')) return 'image';
  if (TEXT_TYPES.has(type)) return 'text';
  if (type.startsWith('text/')) return 'text';
  // +json / +xml structured syntax suffixes and vendor types stay textual.
  if (type.includes('+json') || type.includes('+xml')) return 'json';
  return 'binary';
}

export function isExtractable(route: ContentRoute): boolean {
  return route === 'html' || route === 'json' || route === 'xml' || route === 'text';
}
