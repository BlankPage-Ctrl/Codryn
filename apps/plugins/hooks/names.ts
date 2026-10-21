export const PluginHookNames = {
  BEFORE_TOOL: 'beforeTool',
  AFTER_TOOL: 'afterTool',
  BEFORE_EXECUTE: 'beforeExecute',
  AFTER_EXECUTE: 'afterExecute',
} as const;

export type PluginHookName = (typeof PluginHookNames)[keyof typeof PluginHookNames];

export const ALL_HOOK_NAMES: PluginHookName[] = Object.values(PluginHookNames);

/** The wire method a hook travels on. */
export const PluginHookMethods = {
  BEFORE_TOOL: 'hooks/beforeTool',
  AFTER_TOOL: 'hooks/afterTool',
  BEFORE_EXECUTE: 'hooks/beforeExecute',
  AFTER_EXECUTE: 'hooks/afterExecute',
} as const;

export type PluginHookMethod = (typeof PluginHookMethods)[keyof typeof PluginHookMethods];

export const HOOK_NAME_TO_METHOD: Record<PluginHookName, PluginHookMethod> = {
  beforeTool: PluginHookMethods.BEFORE_TOOL,
  afterTool: PluginHookMethods.AFTER_TOOL,
  beforeExecute: PluginHookMethods.BEFORE_EXECUTE,
  afterExecute: PluginHookMethods.AFTER_EXECUTE,
};
