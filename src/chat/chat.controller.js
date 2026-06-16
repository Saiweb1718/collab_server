import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  getUserChats,
  getMessages,
  isChatMember,
  getOrCreateDirectChat,
  markChatRead,
  getChatMembersDetailed,
  getTotalUnread,
} from './chat.service.js';

export const listMyChats = asyncHandler(async (req, res) => {
  const chats = await getUserChats(req.user.userId);
  return res.status(200).json(new ApiResponse(200, chats, 'OK'));
});

export const getChatMessages = asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  if (!(await isChatMember(chatId, req.user.userId))) {
    throw new ApiError(403, 'You are not a member of this chat');
  }
  const messages = await getMessages(chatId, {
    limit: Number(req.query.limit) || 50,
    before: req.query.before,
  });
  return res.status(200).json(new ApiResponse(200, messages, 'OK'));
});

export const openDirectChat = asyncHandler(async (req, res) => {
  const { userId: otherUserId } = req.body;
  if (!otherUserId) throw new ApiError(400, 'userId is required');
  const chatId = await getOrCreateDirectChat(req.user.userId, otherUserId);
  return res.status(200).json(new ApiResponse(200, { chat_id: chatId }, 'OK'));
});

export const unreadTotal = asyncHandler(async (req, res) => {
  const count = await getTotalUnread(req.user.userId);
  return res.status(200).json(new ApiResponse(200, { count }, 'OK'));
});

export const chatMembers = asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  if (!(await isChatMember(chatId, req.user.userId))) {
    throw new ApiError(403, 'You are not a member of this chat');
  }
  const members = await getChatMembersDetailed(chatId);
  return res.status(200).json(new ApiResponse(200, members, 'OK'));
});

export const readChat = asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  if (!(await isChatMember(chatId, req.user.userId))) {
    throw new ApiError(403, 'You are not a member of this chat');
  }
  await markChatRead(chatId, req.user.userId);
  return res.status(200).json(new ApiResponse(200, null, 'OK'));
});
