import { z } from 'zod';

/** Boundary validation for the plugin delivery layer (HTTP + STDIO). */

export const PluginIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Plugin id must be lowercase alphanumeric with hyphens');

export const PluginWorkspaceParamsSchema = z.object({
  workspaceId: z.string().min(1),
});

export function validatePluginWorkspace(params: unknown) {
  return PluginWorkspaceParamsSchema.parse(params);
}

export const PluginGetParamsSchema = z.object({
  workspaceId: z.string().min(1),
  id: PluginIdSchema,
});

export function validatePluginGet(params: unknown) {
  return PluginGetParamsSchema.parse(params);
}

export const PluginSetEnabledParamsSchema = z.object({
  workspaceId: z.string().min(1),
  id: PluginIdSchema,
  enabled: z.boolean(),
});

export function validatePluginSetEnabled(params: unknown) {
  return PluginSetEnabledParamsSchema.parse(params);
}

export const PluginRegisterParamsSchema = z.object({
  pluginId: PluginIdSchema,
  pluginDir: z.string().trim().min(1).max(1024).optional(),
});

export function validatePluginRegister(params: unknown) {
  return PluginRegisterParamsSchema.parse(params);
}

export const PluginUnregisterParamsSchema = z.object({
  pluginId: PluginIdSchema,
});

export function validatePluginUnregister(params: unknown) {
  return PluginUnregisterParamsSchema.parse(params);
}
