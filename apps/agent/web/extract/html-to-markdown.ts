import { type HTMLElement, Node, NodeType, type Options, parse } from 'node-html-parser';

const PARSE_OPTIONS: Partial<Options> = { lowerCaseTagName: true, comment: false };

const DROP_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'embed',
  'head',
  'meta',
  'link',
  'base',
  'title',
  'form',
  'button',
  'input',
  'select',
  'option',
  'textarea',
  'nav',
  'header',
  'footer',
  'aside',
]);

const HEADING_TAGS: ReadonlySet<string> = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const LIST_TAGS: ReadonlySet<string> = new Set(['ul', 'ol']);
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'blockquote',
  'pre',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'dl',
  'dt',
  'dd',
  'figure',
  'figcaption',
  'details',
  'summary',
  'br',
  'hr',
  'li',
  'ul',
  'ol',
  ...HEADING_TAGS,
]);

export interface HtmlExtraction {
  title: string;
  markdown: string;
}

interface RenderCtx {
  base: URL | null;
}

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === NodeType.ELEMENT_NODE;
}

function tagOf(el: HTMLElement): string {
  return el.rawTagName.toLowerCase();
}

function collapseSpace(value: string): string {
  return value.replace(/\s+/g, ' ');
}

function fenceFor(content: string): string {
  const runs = content.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function absoluteUrl(href: string | undefined, base: URL | null): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('javascript:')) return null;
  try {
    const resolved = base ? new URL(trimmed, base) : new URL(trimmed);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    resolved.hash = '';
    return resolved.toString();
  } catch {
    return null;
  }
}

function renderInline(node: Node, ctx: RenderCtx): string {
  if (!isElement(node)) {
    return collapseSpace(node.text);
  }
  const tag = tagOf(node);
  if (DROP_TAGS.has(tag)) return '';
  if (tag === 'br') return ' \n ';
  if (tag === 'hr') return '';
  if (tag === 'img') {
    const alt = collapseSpace(node.getAttribute('alt') ?? '').trim();
    return alt === '' ? '' : `[img: ${alt}]`;
  }
  if (tag === 'a') {
    const label = node.childNodes
      .map((child) => renderInline(child, ctx))
      .join('')
      .trim();
    const href = absoluteUrl(node.getAttribute('href'), ctx.base);
    if (href === null) return label;
    return label === '' ? href : `[${label}](${href})`;
  }
  if (tag === 'code') {
    const body = node.text.replace(/\s+/g, ' ').trim();
    if (body === '') return '';
    return `${fenceFor(body)}${body}${fenceFor(body)}`;
  }
  return node.childNodes.map((child) => renderInline(child, ctx)).join('');
}

function inlineText(el: HTMLElement, ctx: RenderCtx): string {
  return collapseSpace(el.childNodes.map((child) => renderInline(child, ctx)).join(' ')).trim();
}

function renderList(el: HTMLElement, ctx: RenderCtx, depth: number): string[] {
  const ordered = tagOf(el) === 'ol';
  const indent = '  '.repeat(depth);
  const lines: string[] = [];
  let index = 1;
  for (const child of el.childNodes) {
    if (!isElement(child) || tagOf(child) !== 'li') continue;
    const marker = ordered ? `${index}. ` : '- ';
    index += 1;
    const own: Node[] = [];
    const nested: HTMLElement[] = [];
    for (const inner of child.childNodes) {
      if (isElement(inner) && LIST_TAGS.has(tagOf(inner))) {
        nested.push(inner);
        continue;
      }
      own.push(inner);
    }
    const label = collapseSpace(own.map((n) => renderInline(n, ctx)).join(' ')).trim();
    if (label !== '') lines.push(`${indent}${marker}${label}`);
    for (const list of nested) lines.push(...renderList(list, ctx, depth + 1));
  }
  return lines;
}

function renderPre(el: HTMLElement): string[] {
  const body = el.text.replace(/^\n/, '').replace(/\s+$/, '');
  if (body === '') return [];
  const fence = fenceFor(body);
  return [`${fence}\n${body}\n${fence}`];
}

function renderTable(el: HTMLElement, ctx: RenderCtx): string[] {
  const rows: string[] = [];
  const collect = (node: Node) => {
    if (!isElement(node)) return;
    const tag = tagOf(node);
    if (tag === 'tr') {
      const cells = node.childNodes
        .filter((c): c is HTMLElement => isElement(c) && (tagOf(c) === 'td' || tagOf(c) === 'th'))
        .map((cell) => inlineText(cell, ctx).replace(/\|/g, '\\|'));
      if (cells.length > 0) rows.push(`| ${cells.join(' | ')} |`);
      return;
    }
    node.childNodes.forEach(collect);
  };
  el.childNodes.forEach(collect);
  return rows;
}

function renderBlock(el: HTMLElement, ctx: RenderCtx): string[] {
  const tag = tagOf(el);
  if (DROP_TAGS.has(tag)) return [];

  if (HEADING_TAGS.has(tag)) {
    const level = Number(tag.slice(1));
    const label = inlineText(el, ctx);
    return label === '' ? [] : [`${'#'.repeat(level)} ${label}`];
  }
  if (LIST_TAGS.has(tag)) return renderList(el, ctx, 0);
  if (tag === 'pre') return renderPre(el);
  if (tag === 'table') return renderTable(el, ctx);
  if (tag === 'blockquote') {
    const inner = renderBlocks(el.childNodes, ctx);
    return inner.map((line) => line.replace(/^/gm, '> '));
  }
  if (tag === 'hr') return ['---'];
  if (tag === 'tr') {
    const cells = el.childNodes
      .filter((c): c is HTMLElement => isElement(c) && (tagOf(c) === 'td' || tagOf(c) === 'th'))
      .map((cell) => inlineText(cell, ctx));
    return cells.length === 0 ? [] : [`| ${cells.join(' | ')} |`];
  }
  if (tag === 'li' || tag === 'dt' || tag === 'dd' || tag === 'summary') {
    const label = inlineText(el, ctx);
    return label === '' ? [] : [label];
  }
  return renderBlocks(el.childNodes, ctx);
}

function renderBlocks(nodes: Node[], ctx: RenderCtx): string[] {
  const blocks: string[] = [];
  let pending = '';

  const flush = () => {
    const text = collapseSpace(pending).trim();
    pending = '';
    if (text !== '') blocks.push(text);
  };

  for (const node of nodes) {
    if (!isElement(node)) {
      pending += node.text;
      continue;
    }
    const tag = tagOf(node);
    if (DROP_TAGS.has(tag)) continue;
    if (tag === 'br') {
      pending += '\n';
      continue;
    }
    if (!BLOCK_TAGS.has(tag)) {
      pending += renderInline(node, ctx);
      continue;
    }
    flush();
    blocks.push(...renderBlock(node, ctx));
  }
  flush();
  return blocks;
}

function textLength(nodes: Node[], ctx: RenderCtx): number {
  return renderBlocks(nodes, ctx).join('\n').length;
}

function pickContainer(root: HTMLElement, ctx: RenderCtx): Node[] {
  const body = root.querySelector('body') ?? root;
  const candidates = ['main', 'article', '[role=main]'].map((sel) => body.querySelector(sel));
  const bodyLength = textLength(body.childNodes, ctx);
  for (const candidate of candidates) {
    if (!candidate) continue;
    const length = textLength(candidate.childNodes, ctx);
    // Only narrow to the semantic container when it carries most of the page,
    // otherwise a thin <main> would silently drop the readable content.
    if (bodyLength === 0 || length >= bodyLength * 0.4) return candidate.childNodes;
  }
  return body.childNodes;
}

export function extractHtmlDocument(html: string, baseUrl?: string): HtmlExtraction {
  const root = parse(html, PARSE_OPTIONS);
  const base = (() => {
    if (!baseUrl) return null;
    try {
      return new URL(baseUrl);
    } catch {
      return null;
    }
  })();
  const ctx: RenderCtx = { base };

  // Read <title> before the drop pass removes it.
  const titleEl = root.querySelector('title');
  const rawTitle = titleEl ? collapseSpace(titleEl.text).trim() : '';

  for (const tag of DROP_TAGS) {
    for (const el of root.querySelectorAll(tag)) el.remove();
  }

  const heading = root.querySelector('h1');
  const documentTitle =
    rawTitle !== '' ? rawTitle : collapseSpace(heading ? inlineText(heading, ctx) : '').trim();

  const blocks = renderBlocks(pickContainer(root, ctx), ctx);
  const markdown = blocks
    .join('\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title: documentTitle, markdown };
}

export function extractTextDocument(html: string): string {
  const root = parse(html, PARSE_OPTIONS);
  return root.text.replace(/\s+/g, ' ').trim();
}
