import { randomUUID } from 'crypto';
import { query, withTransaction } from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  requireClusterMember,
  requireClusterAdmin,
  requireClusterOwner,
  getClusterRole,
  CLUSTER_ADMIN_ROLES,
} from '../utils/permissions.js';

export const createCluster = asyncHandler(async (req, res) => {
  const { clusterName } = req.body;
  const userId = req.user.userId;
  if (!clusterName?.trim()) throw new ApiError(400, 'Workspace name is required');

  const code = randomUUID().slice(0, 8).toUpperCase();
  // One atomic round-trip instead of BEGIN + 4 inserts + COMMIT.
  const { rows } = await query(
    `WITH new_chat AS (
       INSERT INTO chats (chat_type) VALUES ('company') RETURNING chat_id
     ), new_cluster AS (
       INSERT INTO clusters (cluster_name, cluster_code, cluster_company_chat_id)
       SELECT $1, $2, chat_id FROM new_chat RETURNING *
     ), cm AS (
       INSERT INTO cluster_members (cluster_member_cluster_id, cluster_member_user_id, cluster_member_role)
       SELECT cluster_id, $3, 'owner' FROM new_cluster
     ), chm AS (
       INSERT INTO chat_members (chat_member_chat_id, chat_member_user_id, chat_member_role)
       SELECT chat_id, $3, 'admin' FROM new_chat
     )
     SELECT * FROM new_cluster`,
    [clusterName.trim(), code, userId]
  );

  return res.status(201).json(new ApiResponse(201, { ...rows[0], userRole: 'owner', memberCount: 1 }, 'Workspace created'));
});

export const joinCluster = asyncHandler(async (req, res) => {
  const { clusterCode } = req.body;
  const userId = req.user.userId;
  if (!clusterCode?.trim()) throw new ApiError(400, 'Invite code is required');

  const cluster = await query(
    'SELECT cluster_id, cluster_company_chat_id FROM clusters WHERE cluster_code = $1',
    [clusterCode.trim().toUpperCase()]
  );
  if (cluster.rowCount === 0) throw new ApiError(404, 'No workspace found with that code');
  const { cluster_id, cluster_company_chat_id } = cluster.rows[0];

  if (await getClusterRole(cluster_id, userId)) throw new ApiError(409, 'You are already a member');

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO cluster_members (cluster_member_cluster_id, cluster_member_user_id, cluster_member_role)
       VALUES ($1,$2,'member')`,
      [cluster_id, userId]
    );
    if (cluster_company_chat_id) {
      await client.query(
        `INSERT INTO chat_members (chat_member_chat_id, chat_member_user_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [cluster_company_chat_id, userId]
      );
    }
  });
  return res.status(200).json(new ApiResponse(200, { cluster_id }, 'Joined workspace'));
});

export const updateCluster = asyncHandler(async (req, res) => {
  const { clusterId } = req.params;
  const { name } = req.body;
  await requireClusterAdmin(clusterId, req.user.userId);
  if (!name?.trim()) throw new ApiError(400, 'Name cannot be empty');

  const { rows } = await query(
    'UPDATE clusters SET cluster_name = $1 WHERE cluster_id = $2 RETURNING *',
    [name.trim(), clusterId]
  );
  if (rows.length === 0) throw new ApiError(404, 'Workspace not found');
  return res.status(200).json(new ApiResponse(200, rows[0], 'Workspace updated'));
});

// GitHub-style delete: owner must type the exact workspace name.
// Archives every member's completed tasks first, then deletes the cluster and
// ALL of its chats (company + per-project) so nothing is left orphaned.
export const deleteCluster = asyncHandler(async (req, res) => {
  const { clusterId } = req.params;
  const { confirmName } = req.body;
  await requireClusterOwner(clusterId, req.user.userId);

  const c = await query('SELECT cluster_name, cluster_company_chat_id FROM clusters WHERE cluster_id = $1', [clusterId]);
  if (c.rowCount === 0) throw new ApiError(404, 'Workspace not found');
  if (confirmName !== c.rows[0].cluster_name) {
    throw new ApiError(400, 'Confirmation text does not match the workspace name');
  }

  await withTransaction(async (client) => {
    // archive completed tasks of every project in this cluster
    await client.query(
      `INSERT INTO task_history
         (history_user_id, history_task_name, history_project_name, history_cluster_name, history_priority, history_completed_at)
       SELECT ta.task_assignment_user_id, t.task_name, p.project_name, c.cluster_name, t.task_priority, t.task_completed_at
         FROM tasks t
         JOIN projects p ON p.project_id = t.task_project_id
         JOIN clusters c ON c.cluster_id = p.project_cluster_id
         JOIN task_assignments ta ON ta.task_assignment_task_id = t.task_id
        WHERE p.project_cluster_id = $1 AND t.task_status = 'done'`,
      [clusterId]
    );
    // collect all chat ids (project chats + company chat) before deleting
    const chats = await client.query(
      `SELECT project_chat_id AS id FROM projects WHERE project_cluster_id = $1 AND project_chat_id IS NOT NULL`,
      [clusterId]
    );
    const chatIds = chats.rows.map((r) => r.id);
    if (c.rows[0].cluster_company_chat_id) chatIds.push(c.rows[0].cluster_company_chat_id);

    await client.query('DELETE FROM clusters WHERE cluster_id = $1', [clusterId]); // cascades projects/tasks/members
    if (chatIds.length) {
      await client.query('DELETE FROM chats WHERE chat_id = ANY($1)', [chatIds]); // cascades messages/members
    }
  });
  return res.status(200).json(new ApiResponse(200, { cluster_id: clusterId }, 'Workspace deleted'));
});

export const getClusterDetails = asyncHandler(async (req, res) => {
  const { clusterId } = req.params;
  const userId = req.user.userId;
  const { rows } = await query(
    `SELECT c.*, cm.cluster_member_role AS "userRole",
            (SELECT COUNT(*)::int FROM cluster_members x WHERE x.cluster_member_cluster_id = c.cluster_id) AS "memberCount"
       FROM clusters c
       JOIN cluster_members cm ON cm.cluster_member_cluster_id = c.cluster_id AND cm.cluster_member_user_id = $2
      WHERE c.cluster_id = $1`,
    [clusterId, userId]
  );
  if (rows.length === 0) throw new ApiError(404, 'Workspace not found or access denied');
  return res.status(200).json(new ApiResponse(200, rows[0], 'OK'));
});

export const getClustersByUser = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const { rows } = await query(
    `SELECT c.cluster_id, c.cluster_name, c.cluster_code, c.cluster_company_chat_id,
            c.cluster_created_at, cm.cluster_member_role AS "userRole",
            cm.cluster_member_joined_at AS "joinedAt",
            (SELECT COUNT(*)::int FROM cluster_members x WHERE x.cluster_member_cluster_id = c.cluster_id) AS "memberCount"
       FROM cluster_members cm
       JOIN clusters c ON c.cluster_id = cm.cluster_member_cluster_id
      WHERE cm.cluster_member_user_id = $1
      ORDER BY cm.cluster_member_joined_at DESC`,
    [userId]
  );
  return res.status(200).json(new ApiResponse(200, rows, 'OK'));
});

export const getClusterMembers = asyncHandler(async (req, res) => {
  const { clusterId } = req.params;
  await requireClusterMember(clusterId, req.user.userId);
  const { rows } = await query(
    `SELECT u.user_id, u.user_name, u.user_email, u.user_avatar_url, u.user_title,
            cm.cluster_member_role AS role, cm.cluster_member_joined_at AS joined_at
       FROM cluster_members cm
       JOIN users u ON u.user_id = cm.cluster_member_user_id
      WHERE cm.cluster_member_cluster_id = $1
      ORDER BY CASE cm.cluster_member_role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
               cm.cluster_member_joined_at`,
    [clusterId]
  );
  return res.status(200).json(new ApiResponse(200, rows, 'OK'));
});

// Promote/demote between admin and member (admins). Cannot touch an owner.
export const setClusterMemberRole = asyncHandler(async (req, res) => {
  const { clusterId, userId: targetId } = req.params;
  const { role } = req.body;
  await requireClusterAdmin(clusterId, req.user.userId);
  if (!['admin', 'member'].includes(role)) throw new ApiError(400, 'Invalid role');

  const target = await getClusterRole(clusterId, targetId);
  if (!target) throw new ApiError(404, 'That user is not a workspace member');
  if (target === 'owner') throw new ApiError(403, 'Cannot change the owner\'s role');

  await query(
    `UPDATE cluster_members SET cluster_member_role = $3
      WHERE cluster_member_cluster_id = $1 AND cluster_member_user_id = $2`,
    [clusterId, targetId, role]
  );
  return res.status(200).json(new ApiResponse(200, { clusterId, userId: targetId, role }, 'Role updated'));
});

export const removeClusterMember = asyncHandler(async (req, res) => {
  const { clusterId, userId: targetId } = req.params;
  const actorRole = await requireClusterAdmin(clusterId, req.user.userId);

  const target = await getClusterRole(clusterId, targetId);
  if (!target) throw new ApiError(404, 'That user is not a workspace member');
  if (target === 'owner') throw new ApiError(403, 'The owner cannot be removed');
  if (target === 'admin' && actorRole !== 'owner') throw new ApiError(403, 'Only the owner can remove an admin');

  // remove from cluster + all its project memberships + all its chats in this cluster
  await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM chat_members cmem
        USING chats ch
        LEFT JOIN projects p ON p.project_chat_id = ch.chat_id
        LEFT JOIN clusters cl ON cl.cluster_company_chat_id = ch.chat_id
       WHERE cmem.chat_member_chat_id = ch.chat_id
         AND cmem.chat_member_user_id = $2
         AND (p.project_cluster_id = $1 OR cl.cluster_id = $1)`,
      [clusterId, targetId]
    );
    await client.query(
      `DELETE FROM task_assignments ta USING tasks t, projects p
        WHERE ta.task_assignment_task_id = t.task_id
          AND t.task_project_id = p.project_id
          AND p.project_cluster_id = $1 AND ta.task_assignment_user_id = $2`,
      [clusterId, targetId]
    );
    await client.query(
      `DELETE FROM project_members pm USING projects p
        WHERE pm.project_member_project_id = p.project_id
          AND p.project_cluster_id = $1 AND pm.project_member_user_id = $2`,
      [clusterId, targetId]
    );
    await client.query(
      'DELETE FROM cluster_members WHERE cluster_member_cluster_id = $1 AND cluster_member_user_id = $2',
      [clusterId, targetId]
    );
  });
  return res.status(200).json(new ApiResponse(200, { clusterId, userId: targetId }, 'Member removed'));
});

export const transferOwnership = asyncHandler(async (req, res) => {
  const { clusterId } = req.params;
  const { userId: targetId } = req.body;
  const actorId = req.user.userId;
  await requireClusterOwner(clusterId, actorId);
  if (!targetId || targetId === actorId) throw new ApiError(400, 'Choose another member');
  if (!(await getClusterRole(clusterId, targetId))) throw new ApiError(404, 'That user is not a member');

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE cluster_members SET cluster_member_role='owner'
        WHERE cluster_member_cluster_id=$1 AND cluster_member_user_id=$2`,
      [clusterId, targetId]
    );
    await client.query(
      `UPDATE cluster_members SET cluster_member_role='admin'
        WHERE cluster_member_cluster_id=$1 AND cluster_member_user_id=$2`,
      [clusterId, actorId]
    );
  });
  return res.status(200).json(new ApiResponse(200, { clusterId, newOwner: targetId }, 'Ownership transferred'));
});
