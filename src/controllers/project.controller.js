import { query, withTransaction } from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  requireClusterMember,
  requireProjectManager,
  getClusterRole,
  getProjectRole,
  CLUSTER_ADMIN_ROLES,
} from '../utils/permissions.js';
import { createNotification, notifyMany, emitToUser } from '../notifications/notification.service.js';

// user ids who can manage a project: its leads + the cluster's owner/admins
const getProjectManagerIds = async (projectId, clusterId) => {
  const { rows } = await query(
    `SELECT DISTINCT uid FROM (
        SELECT project_member_user_id AS uid FROM project_members
          WHERE project_member_project_id = $1 AND project_member_role = 'lead'
        UNION
        SELECT cluster_member_user_id AS uid FROM cluster_members
          WHERE cluster_member_cluster_id = $2 AND cluster_member_role IN ('owner','admin')
     ) m`,
    [projectId, clusterId]
  );
  return rows.map((r) => r.uid);
};

export const createProject = asyncHandler(async (req, res) => {
  const { clusterId, name, description, visibility, taskVisibility } = req.body;
  const userId = req.user.userId;
  if (!clusterId || !name?.trim()) throw new ApiError(400, 'clusterId and name are required');
  await requireClusterMember(clusterId, userId);

  // One atomic round-trip instead of BEGIN + 4 inserts + COMMIT.
  const { rows } = await query(
    `WITH new_chat AS (
       INSERT INTO chats (chat_type) VALUES ('project') RETURNING chat_id
     ), new_project AS (
       INSERT INTO projects (project_cluster_id, project_name, project_description, project_chat_id, project_visibility, project_task_visibility)
       SELECT $1, $2, $3, chat_id, $4, $5 FROM new_chat RETURNING *
     ), pm AS (
       INSERT INTO project_members (project_member_project_id, project_member_user_id, project_member_role)
       SELECT project_id, $6, 'lead' FROM new_project
     ), chm AS (
       INSERT INTO chat_members (chat_member_chat_id, chat_member_user_id, chat_member_role)
       SELECT chat_id, $6, 'admin' FROM new_chat
     )
     SELECT * FROM new_project`,
    [
      clusterId,
      name.trim(),
      description ?? null,
      visibility === 'company' ? 'company' : 'members',
      taskVisibility === 'assignee_only' ? 'assignee_only' : 'all',
      userId,
    ]
  );

  return res.status(201).json(new ApiResponse(201, { ...rows[0], role: 'lead' }, 'Project created'));
});

// Projects in a cluster the user may see: their own + company-visible ones.
export const getProjectsByCluster = asyncHandler(async (req, res) => {
  const { clusterId } = req.params;
  const userId = req.user.userId;
  const clusterRole = await requireClusterMember(clusterId, userId);
  const isAdmin = CLUSTER_ADMIN_ROLES.includes(clusterRole);

  const { rows } = await query(
    `SELECT p.project_id, p.project_name, p.project_description, p.project_chat_id,
            p.project_visibility, p.project_task_visibility, p.project_created_at,
            (SELECT COUNT(*)::int FROM project_members pm WHERE pm.project_member_project_id = p.project_id) AS member_count,
            (SELECT COUNT(*)::int FROM tasks t WHERE t.task_project_id = p.project_id) AS task_count,
            EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_member_project_id = p.project_id AND pm.project_member_user_id = $2) AS is_member,
            (SELECT request_status FROM join_requests jr WHERE jr.request_project_id = p.project_id AND jr.request_user_id = $2 AND jr.request_status='pending' LIMIT 1) AS pending_request
       FROM projects p
      WHERE p.project_cluster_id = $1
        AND ($3 = TRUE
             OR p.project_visibility = 'company'
             OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_member_project_id = p.project_id AND pm.project_member_user_id = $2))
      ORDER BY p.project_created_at DESC`,
    [clusterId, userId, isAdmin]
  );
  return res.status(200).json(new ApiResponse(200, rows, 'OK'));
});

export const getProjectsByUser = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const { rows } = await query(
    `SELECT p.project_id, p.project_name, p.project_description AS description,
            p.project_chat_id AS chat_id, p.project_created_at AS created_at,
            c.cluster_id, c.cluster_name,
            pm.project_member_role AS role, pm.project_member_joined_at AS joined_at
       FROM project_members pm
       JOIN projects p ON p.project_id = pm.project_member_project_id
       JOIN clusters c ON c.cluster_id = p.project_cluster_id
      WHERE pm.project_member_user_id = $1
      ORDER BY pm.project_member_joined_at DESC`,
    [userId]
  );
  return res.status(200).json(new ApiResponse(200, rows, 'OK'));
});

export const getProject = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const userId = req.user.userId;

  const { rows } = await query(
    `SELECT p.project_id, p.project_name, p.project_description, p.project_chat_id,
            p.project_visibility, p.project_task_visibility, p.project_created_at,
            c.cluster_id, c.cluster_name,
            pm.project_member_role AS role,
            (pm.project_member_user_id IS NOT NULL) AS is_member,
            clm.cluster_member_role AS cluster_role,
            (SELECT request_status FROM join_requests jr WHERE jr.request_project_id = p.project_id AND jr.request_user_id = $2 AND jr.request_status='pending' LIMIT 1) AS pending_request
       FROM projects p
       JOIN clusters c ON c.cluster_id = p.project_cluster_id
       JOIN cluster_members clm ON clm.cluster_member_cluster_id = c.cluster_id AND clm.cluster_member_user_id = $2
       LEFT JOIN project_members pm ON pm.project_member_project_id = p.project_id AND pm.project_member_user_id = $2
      WHERE p.project_id = $1`,
    [projectId, userId]
  );
  if (rows.length === 0) throw new ApiError(404, 'Project not found or access denied');

  const p = rows[0];
  // members of a private project they don't belong to can only see metadata
  if (p.project_visibility === 'members' && !p.is_member && !CLUSTER_ADMIN_ROLES.includes(p.cluster_role)) {
    throw new ApiError(403, 'This project is private');
  }
  p.is_manager = p.role === 'lead' || CLUSTER_ADMIN_ROLES.includes(p.cluster_role);
  return res.status(200).json(new ApiResponse(200, p, 'OK'));
});

export const getProjectMembers = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { rows } = await query(
    `SELECT u.user_id, u.user_name, u.user_email, u.user_avatar_url, u.user_title,
            pm.project_member_role AS role, pm.project_member_joined_at AS joined_at
       FROM project_members pm
       JOIN users u ON u.user_id = pm.project_member_user_id
      WHERE pm.project_member_project_id = $1
      ORDER BY pm.project_member_joined_at`,
    [projectId]
  );
  return res.status(200).json(new ApiResponse(200, rows, 'OK'));
});

export const updateProject = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  await requireProjectManager(projectId, req.user.userId);
  const { name, description, visibility, taskVisibility } = req.body;

  const fields = [];
  const values = [];
  let i = 1;
  const set = (col, val) => { fields.push(`${col} = $${i++}`); values.push(val); };
  if (name !== undefined) {
    if (!name.trim()) throw new ApiError(400, 'Name cannot be empty');
    set('project_name', name.trim());
  }
  if (description !== undefined) set('project_description', description);
  if (visibility !== undefined) {
    if (!['members', 'company'].includes(visibility)) throw new ApiError(400, 'Invalid visibility');
    set('project_visibility', visibility);
  }
  if (taskVisibility !== undefined) {
    if (!['all', 'assignee_only'].includes(taskVisibility)) throw new ApiError(400, 'Invalid task visibility');
    set('project_task_visibility', taskVisibility);
  }
  if (fields.length === 0) throw new ApiError(400, 'Nothing to update');

  values.push(projectId);
  const { rows } = await query(
    `UPDATE projects SET ${fields.join(', ')} WHERE project_id = $${i} RETURNING *`,
    values
  );
  return res.status(200).json(new ApiResponse(200, rows[0], 'Project updated'));
});

// GitHub-style: caller must type the exact project name to confirm deletion.
// Archives each member's completed tasks first (so their history survives),
// then deletes the project AND its chat (avoiding orphaned chats/messages).
export const deleteProject = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { confirmName } = req.body;
  await requireProjectManager(projectId, req.user.userId);

  const proj = await query('SELECT project_name, project_chat_id FROM projects WHERE project_id = $1', [projectId]);
  if (proj.rowCount === 0) throw new ApiError(404, 'Project not found');
  if (confirmName !== proj.rows[0].project_name) {
    throw new ApiError(400, 'Confirmation text does not match the project name');
  }

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO task_history
         (history_user_id, history_task_name, history_project_name, history_cluster_name, history_priority, history_completed_at)
       SELECT ta.task_assignment_user_id, t.task_name, p.project_name, c.cluster_name, t.task_priority, t.task_completed_at
         FROM tasks t
         JOIN projects p ON p.project_id = t.task_project_id
         JOIN clusters c ON c.cluster_id = p.project_cluster_id
         JOIN task_assignments ta ON ta.task_assignment_task_id = t.task_id
        WHERE t.task_project_id = $1 AND t.task_status = 'done'`,
      [projectId]
    );
    await client.query('DELETE FROM projects WHERE project_id = $1', [projectId]); // cascades tasks/members
    if (proj.rows[0].project_chat_id) {
      await client.query('DELETE FROM chats WHERE chat_id = $1', [proj.rows[0].project_chat_id]); // cascades messages
    }
  });
  return res.status(200).json(new ApiResponse(200, { project_id: projectId }, 'Project deleted'));
});

// Admin/lead directly adds a cluster member to the project.
export const addMember = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { userId: targetId } = req.body;
  const { clusterId } = await requireProjectManager(projectId, req.user.userId);
  if (!targetId) throw new ApiError(400, 'userId is required');

  if (!(await getClusterRole(clusterId, targetId))) {
    throw new ApiError(400, 'That user is not a member of this workspace');
  }

  const proj = await query('SELECT project_chat_id, project_name FROM projects WHERE project_id = $1', [projectId]);

  await withTransaction(async (client) => {
    // Auto-heal: if the project has no lead (e.g. a previously orphaned one),
    // the first person added becomes its lead.
    const hasLead = await client.query(
      `SELECT 1 FROM project_members WHERE project_member_project_id = $1 AND project_member_role = 'lead' LIMIT 1`,
      [projectId]
    );
    const newRole = hasLead.rowCount === 0 ? 'lead' : 'member';
    await client.query(
      `INSERT INTO project_members (project_member_project_id, project_member_user_id, project_member_role)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [projectId, targetId, newRole]
    );
    if (proj.rows[0].project_chat_id) {
      await client.query(
        `INSERT INTO chat_members (chat_member_chat_id, chat_member_user_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [proj.rows[0].project_chat_id, targetId]
      );
    }
  });

  await createNotification({
    userId: targetId,
    sourceUserId: req.user.userId,
    type: 'project_invite',
    entityType: 'project',
    entityId: projectId,
    message: `You were added to "${proj.rows[0].project_name}"`,
  });
  emitToUser(targetId, 'membership:changed', { projectId, clusterId, status: 'added' });

  return res.status(200).json(new ApiResponse(200, { projectId, userId: targetId }, 'Member added'));
});

export const removeMember = asyncHandler(async (req, res) => {
  const { projectId, userId: targetId } = req.params;
  const { clusterId } = await requireProjectManager(projectId, req.user.userId);

  const proj = await query('SELECT project_chat_id FROM projects WHERE project_id = $1', [projectId]);
  await withTransaction(async (client) => {
    // Lock the project's lead rows so concurrent removals serialize. This is the
    // guard that stops two leads from removing each other and orphaning the
    // project: the second removal re-reads the (now smaller) lead set and is
    // blocked if it would remove the last lead.
    const leads = await client.query(
      `SELECT project_member_user_id AS id FROM project_members
        WHERE project_member_project_id = $1 AND project_member_role = 'lead' FOR UPDATE`,
      [projectId]
    );
    const leadIds = leads.rows.map((r) => r.id);
    if (leadIds.includes(targetId) && leadIds.length <= 1) {
      throw new ApiError(400, 'You can\'t remove the only project lead. Assign another lead first.');
    }
    await client.query(
      'DELETE FROM project_members WHERE project_member_project_id = $1 AND project_member_user_id = $2',
      [projectId, targetId]
    );
    // unassign them from this project's tasks
    await client.query(
      `DELETE FROM task_assignments ta USING tasks t
        WHERE ta.task_assignment_task_id = t.task_id
          AND t.task_project_id = $1 AND ta.task_assignment_user_id = $2`,
      [projectId, targetId]
    );
    if (proj.rows[0]?.project_chat_id) {
      await client.query(
        'DELETE FROM chat_members WHERE chat_member_chat_id = $1 AND chat_member_user_id = $2',
        [proj.rows[0].project_chat_id, targetId]
      );
    }
  });
  emitToUser(targetId, 'membership:changed', { projectId, clusterId, status: 'removed' });
  return res.status(200).json(new ApiResponse(200, { projectId, userId: targetId }, 'Member removed'));
});

export const setMemberRole = asyncHandler(async (req, res) => {
  const { projectId, userId: targetId } = req.params;
  const { role } = req.body;
  await requireProjectManager(projectId, req.user.userId);
  if (!['lead', 'member'].includes(role)) throw new ApiError(400, 'Invalid role');

  const updated = await withTransaction(async (client) => {
    if (role === 'member') {
      // demoting a lead — make sure it isn't the last one
      const leads = await client.query(
        `SELECT project_member_user_id AS id FROM project_members
          WHERE project_member_project_id = $1 AND project_member_role = 'lead' FOR UPDATE`,
        [projectId]
      );
      const leadIds = leads.rows.map((r) => r.id);
      if (leadIds.includes(targetId) && leadIds.length <= 1) {
        throw new ApiError(400, 'You can\'t demote the only project lead. Promote another lead first.');
      }
    }
    const { rowCount } = await client.query(
      `UPDATE project_members SET project_member_role = $3
        WHERE project_member_project_id = $1 AND project_member_user_id = $2`,
      [projectId, targetId, role]
    );
    return rowCount;
  });
  if (updated === 0) throw new ApiError(404, 'That user is not a project member');
  return res.status(200).json(new ApiResponse(200, { projectId, userId: targetId, role }, 'Role updated'));
});

export const leaveProject = asyncHandler(async (req, res) => {
  const { projectId } = req.body;
  const userId = req.user.userId;
  if (!projectId) throw new ApiError(400, 'projectId is required');

  const proj = await query('SELECT project_chat_id FROM projects WHERE project_id = $1', [projectId]);
  const removed = await withTransaction(async (client) => {
    const leads = await client.query(
      `SELECT project_member_user_id AS id FROM project_members
        WHERE project_member_project_id = $1 AND project_member_role = 'lead' FOR UPDATE`,
      [projectId]
    );
    const leadIds = leads.rows.map((r) => r.id);
    if (leadIds.includes(userId) && leadIds.length <= 1) {
      throw new ApiError(400, 'You are the only project lead. Assign another lead or delete the project before leaving.');
    }
    const del = await client.query(
      'DELETE FROM project_members WHERE project_member_project_id = $1 AND project_member_user_id = $2',
      [projectId, userId]
    );
    if (del.rowCount > 0) {
      await client.query(
        `DELETE FROM task_assignments ta USING tasks t
          WHERE ta.task_assignment_task_id = t.task_id
            AND t.task_project_id = $1 AND ta.task_assignment_user_id = $2`,
        [projectId, userId]
      );
      if (proj.rows[0]?.project_chat_id) {
        await client.query('DELETE FROM chat_members WHERE chat_member_chat_id = $1 AND chat_member_user_id = $2', [
          proj.rows[0].project_chat_id,
          userId,
        ]);
      }
    }
    return del.rowCount;
  });
  if (removed === 0) throw new ApiError(404, 'You are not a member of this project');
  return res.status(200).json(new ApiResponse(200, { projectId }, 'Left project'));
});

// ===== Join requests =====
export const requestToJoin = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const { message } = req.body;
  const userId = req.user.userId;

  const proj = await query('SELECT project_cluster_id, project_name FROM projects WHERE project_id = $1', [projectId]);
  if (proj.rowCount === 0) throw new ApiError(404, 'Project not found');
  const clusterId = proj.rows[0].project_cluster_id;
  await requireClusterMember(clusterId, userId);

  if (await getProjectRole(projectId, userId)) throw new ApiError(409, 'You are already a member');

  const inserted = await query(
    `INSERT INTO join_requests (request_project_id, request_user_id, request_message)
     VALUES ($1,$2,$3)
     ON CONFLICT (request_project_id, request_user_id) WHERE request_status='pending'
     DO NOTHING
     RETURNING request_id`,
    [projectId, userId, message ?? null]
  );
  if (inserted.rowCount === 0) throw new ApiError(409, 'You already have a pending request');

  const managerIds = await getProjectManagerIds(projectId, clusterId);
  await notifyMany(managerIds, {
    sourceUserId: userId,
    type: 'join_request',
    entityType: 'project',
    entityId: projectId,
    message: `${req.user.name} requested to join "${proj.rows[0].project_name}"`,
  });

  return res.status(201).json(new ApiResponse(201, { request_id: inserted.rows[0].request_id }, 'Request sent'));
});

export const listJoinRequests = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  await requireProjectManager(projectId, req.user.userId);
  const { rows } = await query(
    `SELECT jr.request_id, jr.request_message, jr.request_created_at,
            u.user_id, u.user_name, u.user_email, u.user_avatar_url
       FROM join_requests jr
       JOIN users u ON u.user_id = jr.request_user_id
      WHERE jr.request_project_id = $1 AND jr.request_status = 'pending'
      ORDER BY jr.request_created_at`,
    [projectId]
  );
  return res.status(200).json(new ApiResponse(200, rows, 'OK'));
});

export const decideJoinRequest = asyncHandler(async (req, res) => {
  const { projectId, requestId } = req.params;
  const { decision } = req.body; // 'approve' | 'reject'
  const deciderId = req.user.userId;
  const { clusterId } = await requireProjectManager(projectId, deciderId);
  if (!['approve', 'reject'].includes(decision)) throw new ApiError(400, 'Invalid decision');

  const reqRow = await query(
    `SELECT request_user_id FROM join_requests
      WHERE request_id = $1 AND request_project_id = $2 AND request_status = 'pending'`,
    [requestId, projectId]
  );
  if (reqRow.rowCount === 0) throw new ApiError(404, 'Pending request not found');
  const requesterId = reqRow.rows[0].request_user_id;

  const proj = await query('SELECT project_chat_id, project_name FROM projects WHERE project_id = $1', [projectId]);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE join_requests SET request_status = $1, request_decided_by = $2, request_decided_at = now()
        WHERE request_id = $3`,
      [decision === 'approve' ? 'approved' : 'rejected', deciderId, requestId]
    );
    if (decision === 'approve') {
      // Auto-heal a leaderless (previously orphaned) project.
      const hasLead = await client.query(
        `SELECT 1 FROM project_members WHERE project_member_project_id = $1 AND project_member_role = 'lead' LIMIT 1`,
        [projectId]
      );
      const newRole = hasLead.rowCount === 0 ? 'lead' : 'member';
      await client.query(
        `INSERT INTO project_members (project_member_project_id, project_member_user_id, project_member_role)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [projectId, requesterId, newRole]
      );
      if (proj.rows[0].project_chat_id) {
        await client.query(
          `INSERT INTO chat_members (chat_member_chat_id, chat_member_user_id)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [proj.rows[0].project_chat_id, requesterId]
        );
      }
    }
  });

  await createNotification({
    userId: requesterId,
    sourceUserId: deciderId,
    type: decision === 'approve' ? 'join_approved' : 'join_rejected',
    entityType: 'project',
    entityId: projectId,
    message:
      decision === 'approve'
        ? `Your request to join "${proj.rows[0].project_name}" was approved`
        : `Your request to join "${proj.rows[0].project_name}" was declined`,
  });
  emitToUser(requesterId, 'membership:changed', {
    projectId,
    clusterId,
    status: decision === 'approve' ? 'approved' : 'rejected',
  });

  return res.status(200).json(new ApiResponse(200, { requestId, decision }, 'Request updated'));
});
