export type InsightSearchMode = 'auto' | 'exact' | 'prefix' | 'substring' | 'fts';

/** Source language of an indexed file (mirrors search/trace schema `dialect`). */
export type InsightDialect = 'typescript' | 'python' | 'go';

/** Symbol kinds emitted by the extractor (TS + Python + Go). */
export type InsightSymbolKind =
  | 'function'
  | 'method'
  | 'arrow'
  | 'constructor'
  | 'generator'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'module'
  | 'const'
  | 'unresolved'
  | 'async-function'
  | 'async-arrow'
  | 'async-method';

/** Structural container kinds. Go structs ride as `class`. */
export type InsightContainerKind = 'file' | 'class' | 'module' | 'namespace' | 'function';

export interface InsightSearchOptions {
  query: string;
  mode?: InsightSearchMode;
  limit?: number;
  file?: string;
  container?: string;
}

export type InsightSearchHitMode = 'exact' | 'prefix' | 'fts' | 'substring';

export interface InsightSearchHit {
  id: string;
  name: string;
  /** Fully-qualified name (e.g. `Program.shutdown`). Required on the wire. */
  qualifiedName: string;
  kind: InsightSymbolKind;
  filePath: string;
  lineRange: { start: number; end: number };
  dialect: InsightDialect;
  /** One-line head; never includes the body. */
  signature: string;
  /** Preceding contiguous comment block, if any. */
  doc: string;
  /** Entry-level convention marks (e.g. `controller`, `route:Get`). Omitted when empty. */
  tags?: string[];
  vessel?: InsightContainer;
  /** Raw FTS5 bm25 for fts hits (negative, smaller = more relevant); 0 otherwise. */
  score: number;
  /** Winning primitive for this hit. */
  mode: InsightSearchHitMode;
  /** 0-based position inside the primitive page before union/filter. */
  rank: number;
}

export interface InsightStats {
  filesScanned: number;
  functionsIndexed: number;
  nodesReturned: number;
  /** Always emitted on the wire (no omitempty); 0 for search. */
  edgesReturned: number;
  /** Omitted when zero. */
  internalCalls?: number;
  /** Omitted when zero. */
  externalCalls?: number;
  /** Omitted when zero. */
  unresolvedCalls?: number;
}

export interface InsightSearchResult {
  query: string;
  hits: InsightSearchHit[];
  stats: InsightStats;
}

export type InsightEdgeKind = 'calls' | 'extends' | 'implements' | 'param' | 'return' | 'uses';

export interface InsightGraphOptions {
  id: string;
  kinds?: InsightEdgeKind[];
}

export interface InsightLineRange {
  start: number;
  end: number;
}

export interface InsightFunctionRef {
  id: string;
  name: string;
  filePath: string;
  lineRange: { start: number; end: number };
  /**
   * Callee classification: `internal:<file>` (resolves to an indexed
   * project function), `internal` (unresolved but imported from a project
   * module), `external:<module>` (external dependency), `external:runtime`
   * (language/global builtin), or `unresolved` (cannot tell).
   */
  scope?: string;
  /**
   * Call-site range inside the caller. Zero value `{start:0,end:0}` means
   * unknown - treat 0 as unknown, not as line 0.
   */
  siteRange?: InsightLineRange;
  /** Branch condition guarding this call site. Omitted when unconditional or unknown. */
  cond?: string;
}

export interface InsightContainer {
  kind: InsightContainerKind;
  id: string;
  name: string;
}

export interface InsightNode {
  id: string;
  name: string;
  filePath: string;
  lineRange: { start: number; end: number };
  siteRange?: InsightLineRange;
  kind: InsightSymbolKind;
  /** Enclosing file container; always present. */
  file: InsightContainer;
  /** Nearest enclosing class/module container, if any. */
  container?: InsightContainer;
  /** One-line head (or type/const declaration head); never includes the body. */
  signature: string;
  /** Preceding contiguous comment block, if any. */
  doc?: string;
  /** Test-case title when an anonymous def is a test()/it() callback. Omitted when empty. */
  testTitle?: string;
  /** Entry-level convention marks. Omitted when empty. */
  tags?: string[];
  calls: InsightFunctionRef[];
  calledBy: InsightFunctionRef[];
  /** Type heritage targets (edge kind 'extends'). Empty for function nodes. */
  extends?: InsightFunctionRef[];
  /** Interfaces implemented by class nodes (edge kind 'implements'). */
  implements?: InsightFunctionRef[];
  /** Typed params unwrapped to base type refs (edge kind 'param'). */
  paramTypes?: InsightFunctionRef[];
  /** Typed returns unwrapped to base type refs (edge kind 'return'). */
  returnTypes?: InsightFunctionRef[];
  /** Const value dependencies unwrapped to identifier refs (edge kind 'uses'). */
  uses?: InsightFunctionRef[];
}

export interface InsightEdge {
  from: string;
  to: string;
  kind: InsightEdgeKind;
  /**
   * Call-site range inside the From node. Zero value `{start:0,end:0}`
   * means unknown (always emitted on the wire; Go struct-value omitempty
   * never omits it) - treat 0 as unknown, not as line 0.
   */
  siteRange?: InsightLineRange;
  /** Branch condition guarding the call site. Omitted when unconditional or unknown. */
  cond?: string;
}

export interface InsightGraph {
  nodes: InsightNode[];
  edges: InsightEdge[];
}

export interface InsightTraceOptions {
  query?: string;
  from?: string;
  to?: string;
  maxDepth?: number;
  maxTrails?: number;
  kinds?: InsightEdgeKind[];
}

export interface InsightTrail {
  steps: string[];
  edges: InsightEdge[];
}

export interface InsightLooseRef {
  name: string;
  kind: string;
  scope: string;
  siteRange?: InsightLineRange;
}

export type InsightImportKind = 'default' | 'named' | 'namespace' | 'side-effect' | 'gopackage';

export interface InsightImportStmt {
  localName: string;
  source: string;
  kind: InsightImportKind;
  /**
   * Alias target for `as` renames. Always emitted on the wire
   * (`""` when none, no omitempty).
   */
  alias: string;
}

/** One node's wash: exact incoming-calls count plus caller/test files. */
export interface InsightRipple {
  /** Exact COUNT of incoming calls edges, never capped. */
  callers: number;
  /** Sorted unique hop-1 caller files, capped at 8. */
  files?: string[];
  /** Sorted unique test files within 3 caller hops, capped at 8. */
  tests?: string[];
  /** Unique hop-1 caller files seen (exact unless truncated). Omitted when zero. */
  fileTotal?: number;
  /** Unique test files seen (exact unless truncated). Omitted when zero. */
  testTotal?: number;
  /** True when the 150-node walk cap or an 8-file list cap cut the answer short. */
  truncated?: boolean;
}

export interface InsightTraceReport {
  /** Symbol-shaped tokens split from the query (plus from/to when directed). */
  tokens: string[];
  /** Per-token vault resolution. Empty array = token did not resolve. */
  anchors: Record<string, InsightSearchHit[]>;
  trails: InsightTrail[];
  /** Every anchor + trail step hydrated plus their 1-hop neighborhood. Sorted by id. */
  nodes: InsightNode[];
  /** Trail calls edges plus the 1-hop neighborhood edges. Sorted by from/to/kind/siteRange. */
  edges: InsightEdge[];
  /** Unresolvable refs by owner EntryID. Omitted when empty. */
  loose?: Record<string, InsightLooseRef[]>;
  /** Import statements per file touching the node set. Omitted when empty. */
  imports?: Record<string, InsightImportStmt[]>;
  /** Wash per head (anchors + trail steps). Omitted when empty. */
  ripples?: Record<string, InsightRipple>;
  stats: InsightStats;
}

export type InsightSyncOptions = Record<string, never>;
// Sending {force} is rejected with -32602; use insightIndex({force}) instead.

export interface InsightIndexOptions {
  force?: boolean;
}

export interface InsightSyncResult {
  filesChecked: number;
  added: number;
  modified: number;
  removed: number;
}

export interface InsightStatusResult {
  syncing: boolean;
  pending: number;
  requiresFull: boolean;
}

export interface InsightDbPaths {
  root: string;
  dir: string;
  db: string;
}

export interface InsightLogger {
  debug?(obj: unknown, msg?: string): void;
  info?(obj: unknown, msg?: string): void;
  warn?(obj: unknown, msg?: string): void;
  error?(obj: unknown, msg?: string): void;
}

export interface InsightSettingsPort {
  getValue(key: string): Promise<string | null>;
}

export interface InsightExecuteDeps {
  workspaceId: string;
  projectPath: string;
  settings: InsightSettingsPort;
  logger?: InsightLogger;
  binaryPath?: string;
  dbFolder?: string;
}

export interface InsightBinarySummary {
  path: string;
  source: string;
  version: string | null;
  compatible: boolean;
  warning?: string;
}

export interface InsightEnsureResult {
  workspaceId: string;
  enabled: boolean;
  running: boolean;
  projectPath: string;
  binary?: InsightBinarySummary;
}
