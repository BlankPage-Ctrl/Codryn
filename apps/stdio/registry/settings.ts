import { z } from 'zod';
import { getSetting, setSetting, querySettings, countSettings } from '../../actions/index.js';
import {
  SettingKeyParamsSchema,
  SettingValueSchema,
  validateSettingsQuery,
} from '../../validators/settings.js';
import { act, IdSchema, type StdioMethod } from './types.js';

export const settingsMethods: Record<string, StdioMethod> = {
  'get.setting': {
    kind: 'plain',
    validate: (p) => SettingKeyParamsSchema.parse(p),
    run: act(getSetting),
  },
  'set.setting': {
    kind: 'plain',
    validate: (p) => z.object({ key: IdSchema, value: SettingValueSchema.shape.value }).parse(p),
    run: act(setSetting),
  },
  'query.settings': {
    kind: 'plain',
    validate: (p) => validateSettingsQuery(p ?? {}),
    run: act(querySettings),
  },
  'count.settings': {
    kind: 'plain',
    validate: (p) => validateSettingsQuery(p ?? {}),
    run: act(countSettings),
  },
  'list.settings': {
    kind: 'plain',
    validate: (p) => validateSettingsQuery(p ?? {}),
    run: act(querySettings),
  },
};
