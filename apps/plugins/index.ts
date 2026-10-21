export type {
  PluginCaps,
  PluginLogger,
  PluginRegistryEntry,
  DiscoveredPlugin,
  PluginSkill,
  PluginSourceKind,
  PluginState,
  PluginStatus,
} from './types.js';
export {
  PLUGINS_DIR,
  PLUGINS_REGISTRY_FILE,
  discoverPlugins,
  registerPlugin,
  unregisterPlugin,
  setPluginEnabled,
  loadRegisteredPlugins,
  resolvePluginDir,
} from './external-registry.js';
export {
  PLUGIN_SETTING_PREFIX,
  isPluginEnabled,
  pluginKey,
  setPluginEnabled as setPluginEnabledSetting,
  type PluginSettingsPort,
} from './settings.js';
export { scanPluginCaps } from './manifest.js';
export { loadPluginDirSkills } from './skills.js';
export {
  applyGlobalLimits,
  DEFAULT_PLUGIN_CONFIG,
  toPluginLimits,
  type CappedPluginCaps,
  type PluginGlobalLimits,
} from './config.js';
export {
  CODRYN_MANIFEST_FILENAME,
  CodrynPluginManifestSchema,
  loadCodrynManifest,
  PluginToolDeclSchema,
  type CodrynPluginManifest,
  type ManifestLoadResult,
  type PluginToolDecl,
} from './native.js';
export { dedupeToolDecls, scanToolDeclarations } from './safety.js';
export { resolvePluginContract, type PluginContract, type PluginToolContract } from './contract.js';
export { buildPluginBootstrap, loadPluginStates, type PluginLoadResult } from './guard.js';
export {
  HOOK_CONTRACTS,
  HOOK_MODES,
  hookContract,
  hookAllowsMode,
  isHookMode,
  resolveHookSubscription,
  PluginHookModeSchema,
  PluginHookDeclSchema,
  PluginHookEntrySchema,
  type HookMode,
  type HookContract,
  type HookSubscription,
  type HookTarget,
  type PluginHookDecl,
} from './hooks/contracts.js';
export {
  PluginHookNames,
  ALL_HOOK_NAMES,
  PluginHookMethods,
  HOOK_NAME_TO_METHOD,
  type PluginHookName,
  type PluginHookMethod,
} from './hooks/names.js';
export {
  diffPayload,
  applyChanges,
  escapePointerSegment,
  unescapePointerSegment,
  pointerSegments,
  type HookChange,
  type HookChangeOp,
} from './hooks/diff.js';
export {
  mergeHookWrites,
  type HookWrite,
  type HookConflict,
  type HookConflictPolicy,
  type HookMergeResult,
} from './hooks/merge.js';
export {
  HookBus,
  type HookBusOptions,
  type HookContext,
  type HookOutcome,
  type HookTransport,
} from './hooks/bus.js';
export { createHookTransport, registerHookRequestHandler } from './hooks/transport.js';
export { resolveHookTargets } from './hooks/subscriptions.js';
export {
  HOOK_DESCRIBE_METHOD,
  describeHooks,
  type AfterExecutePayload,
  type AfterToolPayload,
  type BeforeExecutePayload,
  type BeforeToolPayload,
  type HookPayloads,
  type PluginHookDescribeEntry,
  type PluginHookDescribeResult,
  type PluginHookRequestParams,
  type PluginHookResult,
  type PluginHookVeto,
} from './hooks/protocol.js';
export {
  PluginToolMethods,
  type PluginToolMethod,
  type PluginToolsCallParams,
  type PluginToolsCallResult,
  type PluginToolsListParams,
  type PluginToolsListResult,
} from './tools/protocol.js';
export { callPluginTool, findPluginForTool, listPluginTools } from './tools/registry.js';
export { createPluginTool, createPluginTools, type PluginToolBridgeDeps } from './tools/bridge.js';
export {
  PluginHost,
  type PluginHostOptions,
  type PluginDescriptor,
  type PluginIncomingRequest,
} from './host.js';
export {
  PluginProcess,
  type PluginProcessOptions,
  type PluginRuntimeConfig,
} from './runtime/process.js';
export {
  PluginSessionMethods,
  PluginErrorCode,
  type JsonRpcMessage,
  type PluginSessionMethod,
  type PluginInitializeParams,
  type PluginInitializeResult,
  type PluginPingResult,
  type PluginShutdownResult,
} from './runtime/protocol.js';
export type {
  PluginInternalManifest,
  PluginRequestMessage,
  PluginProcessHandle,
  PluginProcessState,
} from './runtime/types.js';
