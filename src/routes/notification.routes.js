import { Router } from 'express';
import { Authorize } from '../middlewares/auth.middlewares.js';
import {
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
} from '../notifications/notification.controller.js';

const router = Router();
router.use(Authorize);

router.get('/', listNotifications);
router.get('/unread-count', unreadCount);
router.post('/read-all', markAllRead);
router.post('/:id/read', markRead);

export default router;
