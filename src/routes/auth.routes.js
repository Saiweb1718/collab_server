import { Router } from 'express';
import { signup, login, logout, me } from '../controllers/auth.controller.js';
import { Authorize } from '../middlewares/auth.middlewares.js';

const router = Router();

router.post('/signup', signup);
router.post('/login', login);
router.post('/logout', logout);
router.get('/me', Authorize, me);

export default router;
