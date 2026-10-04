import {
  listMessages,
  revertMessageRun,
  previewMessageRun,
  getChatUsage,
  getMessageUsage,
} from '../../actions/index.js';
import {
  MessageParamsSchema,
  MessageUsageParamsSchema,
  RevertMessageBodySchema,
  RevertPreviewBodySchema,
} from '../../validators/message.js';
import { act, type StdioMethod } from './types.js';

export const messageMethods: Record<string, StdioMethod> = {
  'list.message': {
    kind: 'plain',
    validate: (p) => MessageParamsSchema.parse(p),
    run: act(listMessages),
  },
  'get.chat-usage': {
    kind: 'plain',
    validate: (p) => MessageParamsSchema.parse(p),
    run: act(getChatUsage),
  },
  'get.message-usage': {
    kind: 'plain',
    validate: (p) => MessageUsageParamsSchema.parse(p),
    run: act(getMessageUsage),
  },
  'revert.message-run': {
    kind: 'plain',
    validate: (p) => MessageParamsSchema.extend(RevertMessageBodySchema.shape).parse(p),
    run: act(revertMessageRun),
  },
  'preview.message-run': {
    kind: 'plain',
    validate: (p) => MessageParamsSchema.extend(RevertPreviewBodySchema.shape).parse(p),
    run: act(previewMessageRun),
  },
};
