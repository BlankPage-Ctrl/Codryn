import { z } from 'zod';
import {
  listChats,
  getChat,
  createChat,
  updateChat,
  deleteChat,
  generateChatTitle,
} from '../../actions/index.js';
import {
  WorkspaceIdParamsSchema,
  ChatParamsSchema,
  CreateChatSchema,
  UpdateChatSchema,
  GenerateChatTitleSchema,
} from '../../validators/chat.js';
import { act, IdSchema, type StdioMethod } from './types.js';

export const chatMethods: Record<string, StdioMethod> = {
  'list.chat': {
    kind: 'plain',
    validate: (p) => WorkspaceIdParamsSchema.parse(p),
    run: act(listChats),
  },
  'get.chat': {
    kind: 'plain',
    validate: (p) => ChatParamsSchema.parse(p),
    run: act(getChat),
  },
  'create.chat': {
    kind: 'plain',
    validate: (p) => z.object({ workspaceId: IdSchema }).extend(CreateChatSchema.shape).parse(p),
    run: act(createChat),
  },
  'update.chat': {
    kind: 'plain',
    validate: (p) =>
      z.object({ workspaceId: IdSchema, id: IdSchema }).extend(UpdateChatSchema.shape).parse(p),
    run: act(updateChat),
  },
  'delete.chat': {
    kind: 'plain',
    validate: (p) => ChatParamsSchema.parse(p),
    run: act(deleteChat),
  },
  'generate.chat-title': {
    kind: 'plain',
    validate: (p) =>
      z
        .object({ workspaceId: IdSchema, id: IdSchema })
        .extend(GenerateChatTitleSchema.shape)
        .parse(p),
    run: act(
      async (
        ctx,
        params: {
          workspaceId: string;
          id: string;
          text: string;
          providerId?: string;
          modelId?: string;
        },
      ) => {
        return generateChatTitle(ctx, {
          workspaceId: params.workspaceId,
          chatId: params.id,
          text: params.text,
          providerId: params.providerId,
          modelId: params.modelId,
        });
      },
    ),
  },
};
