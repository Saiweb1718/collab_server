import { Router } from 'express';
import { Authorize } from '../middlewares/auth.middlewares.js';
import { globalSearch } from '../controllers/search.controller.js';

const router = Router();
router.use(Authorize);
router.get('/', globalSearch);

export default router;
