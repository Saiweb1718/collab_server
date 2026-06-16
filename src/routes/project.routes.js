import { Router } from 'express';
import { Authorize } from '../middlewares/auth.middlewares.js';
import {
  createProject,
  leaveProject,
  deleteProject,
  updateProject,
  getProjectsByCluster,
  getProjectsByUser,
  getProject,
  getProjectMembers,
  addMember,
  removeMember,
  setMemberRole,
  requestToJoin,
  listJoinRequests,
  decideJoinRequest,
} from '../controllers/project.controller.js';

const router = Router();
router.use(Authorize);

router.post('/', createProject);
router.get('/', getProjectsByUser);
router.post('/leave', leaveProject);

router.get('/cluster/:clusterId', getProjectsByCluster);

router.get('/:projectId', getProject);
router.patch('/:projectId', updateProject);
router.delete('/:projectId', deleteProject);

router.get('/:projectId/members', getProjectMembers);
router.post('/:projectId/members', addMember);
router.delete('/:projectId/members/:userId', removeMember);
router.patch('/:projectId/members/:userId', setMemberRole);

router.post('/:projectId/request', requestToJoin);
router.get('/:projectId/requests', listJoinRequests);
router.post('/:projectId/requests/:requestId', decideJoinRequest);

export default router;
