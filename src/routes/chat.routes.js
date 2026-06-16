import { Router } from 'express';
import { Authorize } from '../middlewares/auth.middlewares.js';
import {
  listMyChats,
  getChatMessages,
  openDirectChat,
  readChat,
  chatMembers,
  unreadTotal,
} from '../chat/chat.controller.js';

const router = Router();
router.use(Authorize);

router.get('/', listMyChats);
router.get('/unread-count', unreadTotal);
router.post('/direct', openDirectChat);
router.get('/:chatId/messages', getChatMessages);
router.get('/:chatId/members', chatMembers);
router.post('/:chatId/read', readChat);

export default router;
