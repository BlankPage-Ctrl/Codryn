import { watch, type FSWatcher } from 'chokidar';
import path from 'node:path';
import type { IFileSystem } from '../../types/file-system.js';
import type { IFileWatcher } from '../../types/file-watcher.js';
import { FileType, WatchEventType, type WatchEvent } from '../../types/index.js';
import { checkHasChildren } from '../../utils/fs.js';
import { buildDeletedFileNode, buildFileNode } from '../../utils/node.js';
import { toRelativePath, isOutsideRelative } from '../../utils/path.js';
import { IgnoreFilter } from '../../engines/ignore.js';
import { DEFAULT_IGNORE_PATTERNS, type IgnoreOptions } from '../../types/ignore.js';

// Chokidar reports rename as a separate unlink + add pair (unlike Parcel
// which batches them), so raw events are collected in a short window and
// flushed together to allow move matching.
const MOVE_DEBOUNCE_MS = 300;

interface RawWatchRecord {
  path: string;
  type: 'create' | 'update' | 'delete';
}

interface MovePair {
  from: RawWatchRecord;
  to: RawWatchRecord;
}

export class NodeFileWatcher implements IFileWatcher {
  private chokidarWatcher?: FSWatcher;
  private readonly pending: RawWatchRecord[] = [];
  private flushTimer?: NodeJS.Timeout;
  private readonly knownKinds = new Map<string, FileType>();
  private readonly workspaceRoot: string;
  private readonly ignoreFilter: IgnoreFilter;
  private onEventHandler?: (event: WatchEvent) => void;

  constructor(
    private readonly fileSystem: IFileSystem,
    workspaceRoot: string,
    opts: IgnoreOptions = {},
  ) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.ignoreFilter = new IgnoreFilter([
      ...DEFAULT_IGNORE_PATTERNS,
      ...(opts.ignorePatterns ?? []),
    ]);
  }

  setOnEvent(handler: (event: WatchEvent) => void): void {
    this.onEventHandler = handler;
  }

  async start(): Promise<void> {
    if (this.chokidarWatcher) return;

    const watcher = watch(this.workspaceRoot, {
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      ignored: (absPath: string) => this.shouldIgnoreByPath(absPath),
    });
    this.chokidarWatcher = watcher;

    // Runtime watcher errors are best-effort and ignored, matching the
    // previous Parcel-based behavior which dropped callback errors.
    watcher.on('error', () => {});
    watcher.on('add', (p) => this.buffer('create', p));
    watcher.on('addDir', (p) => this.buffer('create', p));
    watcher.on('change', (p) => this.buffer('update', p));
    watcher.on('unlink', (p) => this.buffer('delete', p));
    watcher.on('unlinkDir', (p) => this.buffer('delete', p));

    try {
      await new Promise<void>((resolve, reject) => {
        const onReady = (): void => {
          watcher.off('error', onError);
          resolve();
        };
        const onError = (err: unknown): void => {
          watcher.off('ready', onReady);
          reject(err);
        };
        watcher.once('ready', onReady);
        watcher.once('error', onError);
      });
    } catch (err) {
      this.chokidarWatcher = undefined;
      await watcher.close().catch(() => {});
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.chokidarWatcher) return;
    const watcher = this.chokidarWatcher;
    this.chokidarWatcher = undefined;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    const remaining = this.pending.splice(0, this.pending.length);
    await watcher.close();
    if (remaining.length > 0) {
      await this.handleEvents(remaining);
    }
  }

  private shouldIgnoreByPath(absPath: string): boolean {
    const resolved = path.resolve(this.workspaceRoot, absPath);
    const relPath = toRelativePath(this.workspaceRoot, resolved);
    if (relPath === '/') return false;
    // Chokidar may call this without stats, so check both variants.
    return this.ignoreFilter.ignores(relPath, false) || this.ignoreFilter.ignores(relPath, true);
  }

  private buffer(type: RawWatchRecord['type'], reportedPath: string): void {
    if (!this.chokidarWatcher) return;
    this.pending.push({
      path: path.resolve(this.workspaceRoot, reportedPath),
      type,
    });
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      const batch = this.pending.splice(0, this.pending.length);
      if (batch.length > 0) {
        void this.handleEvents(batch);
      }
    }, MOVE_DEBOUNCE_MS);
  }

  private async handleEvents(events: RawWatchRecord[]): Promise<void> {
    const pairs = matchMoves(events, this.knownKinds);
    const consumed = new Set<RawWatchRecord>();

    for (const pair of pairs) {
      consumed.add(pair.from);
      consumed.add(pair.to);
      await this.emitMoved(pair.from, pair.to);
    }

    for (const event of events) {
      if (consumed.has(event)) continue;
      switch (event.type) {
        case 'create':
          await this.emitExisting(WatchEventType.CREATED, event.path);
          break;
        case 'update':
          await this.emitExisting(WatchEventType.MODIFIED, event.path);
          break;
        case 'delete':
          this.emitDeleted(event.path);
          break;
      }
    }
  }

  private async emitMoved(from: RawWatchRecord, to: RawWatchRecord): Promise<void> {
    await this.emitExisting(
      WatchEventType.MOVED,
      to.path,
      toRelativePath(this.workspaceRoot, from.path),
    );
  }

  private emitDeleted(absolutePath: string): void {
    const type = this.knownKinds.get(absolutePath) ?? FileType.FILE;
    this.pruneKnownKinds(absolutePath);
    if (this.isIgnored(absolutePath, type === FileType.DIRECTORY)) return;
    this.emitEvent({
      type: WatchEventType.DELETED,
      node: buildDeletedFileNode(absolutePath, this.workspaceRoot, type),
      timestamp: Date.now(),
    });
  }

  private isIgnored(absolutePath: string, isDirectory: boolean): boolean {
    const relPath = toRelativePath(this.workspaceRoot, absolutePath);
    if (relPath === '/') return false;
    return this.ignoreFilter.ignores(relPath, isDirectory);
  }

  private async emitExisting(
    type: WatchEventType.CREATED | WatchEventType.MODIFIED | WatchEventType.MOVED,
    absolutePath: string,
    oldPath?: string,
  ): Promise<void> {
    try {
      const stats = await this.fileSystem.lstat(absolutePath);
      const isDirectory = stats.isDirectory();
      if (this.isIgnored(absolutePath, isDirectory)) return;
      const hasChildren = isDirectory
        ? await checkHasChildren(this.fileSystem, absolutePath)
        : undefined;
      const symlinkTarget = stats.isSymbolicLink()
        ? await this.fileSystem.readlink(absolutePath)
        : undefined;

      const node = buildFileNode(absolutePath, this.workspaceRoot, stats, {
        hasChildren,
        symlinkTarget,
      });
      this.knownKinds.set(absolutePath, node.type);

      this.emitEvent({
        type,
        node,
        ...(oldPath ? { oldPath } : {}),
        timestamp: Date.now(),
      });
    } catch {
      // File can disappear before the event is processed.
    }
  }

  private emitEvent(event: WatchEvent): void {
    this.onEventHandler?.(event);
  }

  private pruneKnownKinds(absolutePath: string): void {
    const prefix = absolutePath + path.sep;
    for (const key of this.knownKinds.keys()) {
      if (key === absolutePath || key.startsWith(prefix)) {
        this.knownKinds.delete(key);
      }
    }
  }
}

function matchMoves(
  events: RawWatchRecord[],
  knownKinds: ReadonlyMap<string, FileType>,
): MovePair[] {
  const deletes = events.filter((event) => event.type === 'delete');
  const creates = events.filter((event) => event.type === 'create');
  const usedCreates = new Set<RawWatchRecord>();
  const pairs: MovePair[] = [];

  for (const del of deletes) {
    const match = creates.find(
      (create) =>
        !usedCreates.has(create) && path.basename(create.path) === path.basename(del.path),
    );
    if (match) {
      usedCreates.add(match);
      pairs.push({ from: del, to: match });
    }
  }

  const remainingDeletes = deletes.filter((del) => !pairs.some((pair) => pair.from === del));
  const remainingCreates = creates.filter((create) => !usedCreates.has(create));

  for (const del of remainingDeletes) {
    if (knownKinds.get(del.path) === FileType.DIRECTORY) continue;
    const index = remainingCreates.findIndex((create) => !isAncestor(del.path, create.path));
    if (index === -1) continue;
    const [match] = remainingCreates.splice(index, 1);
    pairs.push({ from: del, to: match });
  }

  return pairs;
}

function isAncestor(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !isOutsideRelative(rel);
}
