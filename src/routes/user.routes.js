import { Router } from 'express';
import { Authorize } from '../middlewares/auth.middlewares.js';
import { searchUsers, getProfile, updateProfile, changePassword } from '../controllers/user.controller.js';

const router = Router();
router.use(Authorize);

router.get('/search', searchUsers);
router.patch('/me', updateProfile);
router.post('/me/password', changePassword);
router.get('/:userId', getProfile);

export default router;
