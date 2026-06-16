import { Router } from 'express';
import { Authorize } from '../middlewares/auth.middlewares.js';
import {
  createCluster,
  joinCluster,
  updateCluster,
  deleteCluster,
  getClusterDetails,
  getClustersByUser,
  getClusterMembers,
  setClusterMemberRole,
  removeClusterMember,
  transferOwnership,
} from '../controllers/cluster.controller.js';

const router = Router();
router.use(Authorize);

router.post('/', createCluster);
router.post('/join', joinCluster);
router.get('/', getClustersByUser);

router.get('/:clusterId', getClusterDetails);
router.patch('/:clusterId', updateCluster);
router.delete('/:clusterId', deleteCluster);

router.get('/:clusterId/members', getClusterMembers);
router.patch('/:clusterId/members/:userId', setClusterMemberRole);
router.delete('/:clusterId/members/:userId', removeClusterMember);
router.post('/:clusterId/transfer-ownership', transferOwnership);

export default router;
