import { DatabaseManager } from '../src/database/database.manager.js';
import { runMigrations } from '../src/database/migrate.js';
import * as schema from '../src/database/schema/index.js';

// @ Storage
import { ColdClientStorage, HotClientStorage, DefaultClientStore } from '../src/auth/index.js';
import { ColdChatStorage } from '../src/chat/index.js';
import { ColdSettingsStorage } from '../src/settings/index.js';
import { ColdWorkspacesStorage } from '../src/workspaces/index.js';
import {
  ColdMessagesStorage,
  ColdMessagePartsStorage,
  ColdRunStepsStorage,
} from '../src/messages/index.js';
import { ColdNotesStorage, ColdCategoriesStorage } from '../src/notes/index.js';
import { ColdHitlStorage } from '../src/human-in-the-loop/index.js';
import { ColdAttachmentsStorage, FileAttachmentBytesStorage } from '../src/attachments/index.js';
import { resolveAttachmentsDir } from './shared/attachments-dir.js';
import { NodeFileSystem } from '../src/fm/index.js';
import { HitlRepository } from '../src/human-in-the-loop/index.js';
import { HitlService } from '../src/human-in-the-loop/index.js';
import {
  ShellExecutor,
  ShellRepository,
  ShellService,
  ShellExecEventBus,
  defaultGlobalShellConfig,
  type GlobalShellConfig,
} from '../src/shell/index.js';

// @ Repository
import { ClientRepository } from '../src/auth/index.js';
import { ChatRepository } from '../src/chat/index.js';
import { SettingsRepository } from '../src/settings/index.js';
import { WorkspacesRepository } from '../src/workspaces/index.js';
import { MessagesRepository } from '../src/messages/index.js';
import { AttachmentsRepository, AttachmentsService } from '../src/attachments/index.js';
import { NotesRepository, CategoriesRepository } from '../src/notes/index.js';
import {
  ProviderStore,
  ProviderService,
  installProviderPlugins,
  buildReasoningOptions,
  resolveClientFactory,
  getModelCapability,
} from './providers/index.js';
import { FileRepository } from '../src/fm/index.js';
import { ColdFileHistoryStorage } from '../src/fm/index.js';
import { createAgent, type AgentClient } from '../src/agent/index.js';
import { RunHotStorage, RunsRepository, RunsService } from '../src/runs/index.js';
import { ensureGlobalSettings } from './shared/global-settings.js';
import { ensureAllWorkspaceSettings } from './shared/workspace-settings.js';

// @ Service
import { ClientService } from '../src/auth/index.js';
import { ChatService } from '../src/chat/index.js';
import { SettingsService } from '../src/settings/index.js';
import { WorkspacesService } from '../src/workspaces/index.js';
import { MessagesService } from '../src/messages/index.js';
import { NotesService, CategoriesService } from '../src/notes/index.js';
import type { Logger, PluginServerConfig } from './shared/types.js';
import { fallbackLogger } from './shared/logging/fallback.js';
import { DEFAULT_MCP_CONFIG, McpManager, type McpManagerConfig } from './mcp/manager.js';
import {
  DEFAULT_PLUGIN_CONFIG,
  toPluginLimits,
  type PluginGlobalLimits,
} from './plugins/config.js';

export interface Container {
  clientService: ClientService;
  chatService: ChatService;
  settingsService: SettingsService;
  workspacesService: WorkspacesService;
  messagesService: MessagesService;
  attachmentsService: AttachmentsService;
  providerService: ProviderService;
  notesService: NotesService;
  categoriesService: CategoriesService;
  providerStore: ProviderStore;
  fileRepo: FileRepository;
  fileSystem: NodeFileSystem;
  fileHistoryStorage: ColdFileHistoryStorage;
  agent: AgentClient;
  shellService: ShellService;
  shellEnabled: boolean;
  shellExecBus: ShellExecEventBus;
  hitlService: HitlService;
  runService: RunsService;
  mcpManager: McpManager;
  pluginsEnabled: boolean;
  pluginLimits: PluginGlobalLimits;
  logger: Logger;
  shutdown: () => Promise<void>;
}

export type BootstrapShellConfig = GlobalShellConfig;

export interface BootstrapConfig {
  dbPath: string;
  defaultClientSecretKey: string;
  shell?: BootstrapShellConfig;
  mcp?: Partial<McpManagerConfig>;
  plugins?: Partial<PluginServerConfig>;
}

export async function bootstrap(
  config: BootstrapConfig,
  logger: Logger = fallbackLogger('bootstrap'),
  opts: { basePath?: string } = {},
): Promise<Container> {
  const dbManager = new DatabaseManager(schema, config.dbPath);
  const db = await dbManager.init();
  try {
    await runMigrations(config.dbPath);
  } catch (err) {
    logger.warn({ err }, 'migrations skipped (database may already be migrated)');
  }

  // # Storage
  const queue = dbManager.getQueue();
  const coldClientStorage = new ColdClientStorage(db);
  const hotClientStorage = new HotClientStorage();
  const coldChatStorage = new ColdChatStorage(db);
  const coldSettingsStorage = new ColdSettingsStorage(db);
  const coldWorkspacesStorage = new ColdWorkspacesStorage(db);
  const coldMessagesStorage = new ColdMessagesStorage(db);
  const coldMessagePartsStorage = new ColdMessagePartsStorage(db, queue);
  const coldRunStepsStorage = new ColdRunStepsStorage(db, queue);
  const coldNotesStorage = new ColdNotesStorage(db);
  const coldCategoriesStorage = new ColdCategoriesStorage(db);
  const coldHitlStorage = new ColdHitlStorage(db, queue);
  const coldAttachmentsStorage = new ColdAttachmentsStorage(db);
  const attachmentBytesStorage = new FileAttachmentBytesStorage(
    resolveAttachmentsDir(opts.basePath),
  );
  const nodeFileSystem = new NodeFileSystem();

  // # Repository
  const clientRepo = new ClientRepository(coldClientStorage, hotClientStorage);
  const chatRepo = new ChatRepository(coldChatStorage);
  const settingsRepo = new SettingsRepository(coldSettingsStorage);
  const workspacesRepo = new WorkspacesRepository(coldWorkspacesStorage);
  const messagesRepo = new MessagesRepository(
    coldMessagesStorage,
    coldMessagePartsStorage,
    coldRunStepsStorage,
  );
  const attachmentsRepo = new AttachmentsRepository(coldAttachmentsStorage);
  const notesRepo = new NotesRepository(coldNotesStorage);
  const categoriesRepo = new CategoriesRepository(coldCategoriesStorage);
  const fileRepo = new FileRepository(nodeFileSystem);
  const fileHistoryStorage = new ColdFileHistoryStorage(db);
  const hitlRepo = new HitlRepository(coldHitlStorage);
  const hitlService = new HitlService(hitlRepo);
  const runService = new RunsService(new RunsRepository(new RunHotStorage()));

  // # Default Client (in-memory) - empty secret disables the default key.
  const defaultClientSecretKey = config.defaultClientSecretKey ?? '';
  const defaultClientStore =
    defaultClientSecretKey.trim() !== ''
      ? new DefaultClientStore({
          clientId: 'default-client',
          secretKey: defaultClientSecretKey,
        })
      : undefined;

  // # Service
  const clientService = new ClientService(clientRepo, defaultClientStore);
  const chatService = new ChatService(chatRepo);
  const settingsService = new SettingsService(settingsRepo);
  const workspacesService = new WorkspacesService(workspacesRepo);
  const messagesService = new MessagesService(messagesRepo);
  const attachmentsService = new AttachmentsService(attachmentsRepo, attachmentBytesStorage);
  installProviderPlugins();
  const providerStore = new ProviderStore(settingsService);
  const providerService = new ProviderService(providerStore);
  const notesService = new NotesService(notesRepo, categoriesRepo);
  const categoriesService = new CategoriesService(categoriesRepo);

  try {
    await ensureGlobalSettings({ settingsService, logger });
  } catch (err) {
    logger.warn({ err }, 'bootstrap: ensureGlobalSettings failed');
  }
  try {
    await ensureAllWorkspaceSettings({ settingsService, workspacesService, logger });
  } catch (err) {
    logger.warn({ err }, 'bootstrap: ensureAllWorkspaceSettings failed');
  }

  // # Shell
  const shellConfig = defaultGlobalShellConfig(config.shell);
  const shellExecBus = new ShellExecEventBus();
  const shellService = new ShellService(
    new ShellRepository(new ShellExecutor()),
    shellConfig,
    shellExecBus,
  );

  // # MCP (lazy per-workspace connections; nothing connects here).
  const mcpManager = new McpManager({ ...DEFAULT_MCP_CONFIG, ...config.mcp }, logger, undefined, {
    getValue: (key) => settingsService.getValue(key),
    setValue: (key, value) => settingsService.setValue(key, value),
  });

  // # Plugins (unofficial, default off; management + run paths gate on it).
  const pluginConfig = { ...DEFAULT_PLUGIN_CONFIG, ...config.plugins };

  return {
    clientService,
    chatService,
    settingsService,
    workspacesService,
    messagesService,
    attachmentsService,
    providerService,
    notesService,
    categoriesService,
    providerStore,
    fileRepo,
    fileSystem: nodeFileSystem,
    fileHistoryStorage,
    agent: createAgent({
      reasoning: buildReasoningOptions,
      clients: resolveClientFactory,
      capability: getModelCapability,
    }),
    shellService,
    shellEnabled: shellConfig.enabled,
    shellExecBus,
    hitlService,
    runService,
    mcpManager,
    pluginsEnabled: pluginConfig.enabled,
    pluginLimits: toPluginLimits(pluginConfig),
    logger,
    shutdown: async () => {
      // Best-effort: SIGKILL every live shell run before tearing down.
      // Never blocks shutdown and never throws; orphaned OS processes may
      // still survive in edge cases (unkillable / already-orphaned PIDs).
      try {
        const { killedCount } = shellService.killAllRuns();
        if (killedCount > 0) logger.info({ killedCount }, 'shutdown: killed live shell runs');
      } catch (err) {
        logger.warn({ err }, 'shutdown: killAllRuns failed');
      }
      try {
        await mcpManager.closeAll().catch(() => {});
      } catch {
        // ignore mcp shutdown
      }
      try {
        const { getInsightManager } = await import('./insight/manager.js');
        await getInsightManager(logger)
          .stopAll()
          .catch(() => {});
      } catch {
        // ignore insight shutdown
      }
      try {
        await dbManager.checkpoint();
      } finally {
        await dbManager.close();
      }
    },
  };
}
