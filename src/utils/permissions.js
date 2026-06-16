import { query } from '../db/index.js';
import { ApiError } from './ApiError.js';

export const CLUSTER_ADMIN_ROLES = ['owner', 'admin'];

/** The caller's role in a cluster, or null if not a member. */
export const getClusterRole = async (clusterId, userId) => {
  const { rows } = await query(
    `SELECT cluster_member_role AS role FROM cluster_members
      WHERE cluster_member_cluster_id = $1 AND cluster_member_user_id = $2`,
    [clusterId, userId]
  );
  return rows[0]?.role ?? null;
};

/** The caller's role in a project, or null if not a member. */
export const getProjectRole = async (projectId, userId) => {
  const { rows } = await query(
    `SELECT project_member_role AS role FROM project_members
      WHERE project_member_project_id = $1 AND project_member_user_id = $2`,
    [projectId, userId]
  );
  return rows[0]?.role ?? null;
};

/** The cluster a project belongs to. */
export const getProjectClusterId = async (projectId) => {
  const { rows } = await query('SELECT project_cluster_id FROM projects WHERE project_id = $1', [
    projectId,
  ]);
  if (rows.length === 0) throw new ApiError(404, 'Project not found');
  return rows[0].project_cluster_id;
};

export const requireClusterMember = async (clusterId, userId) => {
  const role = await getClusterRole(clusterId, userId);
  if (!role) throw new ApiError(403, 'You are not a member of this workspace');
  return role;
};

export const requireClusterAdmin = async (clusterId, userId) => {
  const role = await getClusterRole(clusterId, userId);
  if (!CLUSTER_ADMIN_ROLES.includes(role)) {
    throw new ApiError(403, 'Only workspace admins can perform this action');
  }
  return role;
};

export const requireClusterOwner = async (clusterId, userId) => {
  const role = await getClusterRole(clusterId, userId);
  if (role !== 'owner') throw new ApiError(403, 'Only the workspace owner can perform this action');
  return role;
};

/**
 * Can the user manage a project? True for project leads and for
 * cluster owners/admins of the project's cluster.
 * Returns { clusterRole, projectRole } for downstream use.
 */
export const requireProjectManager = async (projectId, userId) => {
  const clusterId = await getProjectClusterId(projectId);
  const [clusterRole, projectRole] = await Promise.all([
    getClusterRole(clusterId, userId),
    getProjectRole(projectId, userId),
  ]);
  const isManager = projectRole === 'lead' || CLUSTER_ADMIN_ROLES.includes(clusterRole);
  if (!isManager) throw new ApiError(403, 'Only project leads or workspace admins can do this');
  return { clusterId, clusterRole, projectRole, isManager: true };
};

/**
 * Single-query project context: the caller's project role + cluster role +
 * the project's task visibility, with derived access flags. Replaces 3-6
 * sequential permission round-trips with ONE.
 */
export const getProjectContext = async (projectId, userId) => {
  const { rows } = await query(
    `SELECT p.project_id, p.project_cluster_id AS cluster_id,
            p.project_task_visibility AS task_visibility,
            pm.project_member_role AS project_role,
            cm.cluster_member_role AS cluster_role
       FROM projects p
       LEFT JOIN project_members pm
         ON pm.project_member_project_id = p.project_id AND pm.project_member_user_id = $2
       LEFT JOIN cluster_members cm
         ON cm.cluster_member_cluster_id = p.project_cluster_id AND cm.cluster_member_user_id = $2
      WHERE p.project_id = $1`,
    [projectId, userId]
  );
  if (rows.length === 0) throw new ApiError(404, 'Project not found');
  const r = rows[0];
  const isClusterAdmin = CLUSTER_ADMIN_ROLES.includes(r.cluster_role);
  const isManager = r.project_role === 'lead' || isClusterAdmin;
  return { ...r, isClusterAdmin, isManager, hasAccess: Boolean(r.project_role) || isClusterAdmin };
};

/** Lightweight check used for read gating. */
export const isProjectManager = async (projectId, userId) => {
  const clusterId = await getProjectClusterId(projectId);
  const [clusterRole, projectRole] = await Promise.all([
    getClusterRole(clusterId, userId),
    getProjectRole(projectId, userId),
  ]);
  return projectRole === 'lead' || CLUSTER_ADMIN_ROLES.includes(clusterRole);
};
