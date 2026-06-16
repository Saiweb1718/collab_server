import { Router } from 'express';
import { Authorize } from '../middlewares/auth.middlewares.js';
import {
  createTask,
  updateTask,
  assignTask,
  unassignTask,
  deleteTask,
  getTaskById,
  getTasksByProject,
  getTasksByUser,
} from '../controllers/task.controller.js';

const router = Router();
router.use(Authorize);

router.post('/', createTask);
router.get('/mine', getTasksByUser);
router.get('/project/:projectId', getTasksByProject);
router.get('/:taskId', getTaskById);
router.patch('/:taskId', updateTask);
router.delete('/:taskId', deleteTask);
router.post('/:taskId/assign', assignTask);
router.delete('/:taskId/assign/:userId', unassignTask);

export default router;
