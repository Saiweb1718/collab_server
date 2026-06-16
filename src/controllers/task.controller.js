import { query, withTransaction } from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getProjectRole, isProjectManager, getClusterRole, getProjectClusterId, getProjectContext, CLUSTER_ADMIN_ROLES } from '../utils/permissions.js';
import { createNotification } from '../notifications/notification.service.js';

const ALLOWED_PRIORITY = ['low', 'medium', 'high'];
const ALLOWED_STATUS = ['todo', 'in_progress', 'done'];

const assigneesSelect = `
  COALESCE(json_agg(
    json_build_object('user_id', u.user_id, 'user_name', u.user_name, 'user_avatar_url', u.user_avatar_url)
  ) FILTER (WHERE u.user_id IS NOT NULL), '[]') AS assignees`;

const taskWithAssignees = async (taskId) => {
  const { rows } = await query(
    `SELECT t.*, ${assigneesSelect}
       FROM tasks t
       LEFT JOIN task_assignments ta ON ta.task_assignment_task_id = t.task_id
       LEFT JOIN users u ON u.user_id = ta.task_assignment_user_id
      WHERE t.task_id = $1 GROUP BY t.task_id`,
    [taskId]
  );
  return rows[0];
};

// Require the caller to be a project member (any role) or a workspace admin.
const requireProjectAccess = async (projectId, userId) => {
  const role = await getProjectRole(projectId, userId);
  if (role) return role;
  const clusterId = await getProjectClusterId(projectId);
  const clusterRole = await getClusterRole(clusterId, userId);
  if (CLUSTER_ADMIN_ROLES.includes(clusterRole)) return clusterRole;
  throw new ApiError(403, 'You do not have access to this project');
};

export const createTask = asyncHandler(async (req, res) => {
  const { projectId, taskName, taskDescription, deadline, priority, progress, status, assigneeIds } = req.body;
  if (!projectId || !taskName?.trim()) throw new ApiError(400, 'projectId and taskName are required');
  if (priority && !ALLOWED_PRIORITY.includes(priority)) throw new ApiError(400, 'Invalid priority');
  if (status && !ALLOWED_STATUS.includes(status)) throw new ApiError(400, 'Invalid status');
  await requireProjectAccess(projectId, req.user.userId);

  const completedAt = status === 'done' ? new Date() : null;
  const taskId = await withTransaction(async (client) => {
    const task = await client.query(
      `INSERT INTO tasks (task_project_id, task_name, task_description, task_deadline, task_priority, task_progress, task_status, task_completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING task_id`,
      [projectId, taskName.trim(), taskDescription ?? null, deadline || null, priority || 'medium', progress ?? 0, status || 'todo', completedAt]
    );
    const id = task.rows[0].task_id;
    for (const uid of assigneeIds ?? []) {
      await client.query(
        `INSERT INTO task_assignments (task_assignment_task_id, task_assignment_user_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [id, uid]
      );
    }
    return id;
  });

  // fire-and-forget — never make the user wait on notification writes
  for (const uid of assigneeIds ?? []) {
    createNotification({
      userId: uid,
      sourceUserId: req.user.userId,
      type: 'assignment',
      entityType: 'task',
      entityId: taskId,
      message: `${req.user.name} assigned you "${taskName.trim()}"`,
    });
  }

  return res.status(201).json(new ApiResponse(201, await taskWithAssignees(taskId), 'Task created'));
});

export const updateTask = asyncHandler(async (req, res) => {
  const { taskId } = req.params;
  const { taskName, taskDescription, deadline, priority, progress, status } = req.body;
  if (priority && !ALLOWED_PRIORITY.includes(priority)) throw new ApiError(400, 'Invalid priority');
  if (status && !ALLOWED_STATUS.includes(status)) throw new ApiError(400, 'Invalid status');

  const existing = await query('SELECT task_project_id, task_status FROM tasks WHERE task_id = $1', [taskId]);
  if (existing.rowCount === 0) throw new ApiError(404, 'Task not found');
  await requireProjectAccess(existing.rows[0].task_project_id, req.user.userId);

  const fields = [];
  const values = [];
  let i = 1;
  const set = (col, val) => { fields.push(`${col} = $${i++}`); values.push(val); };
  if (taskName !== undefined) set('task_name', taskName);
  if (taskDescription !== undefined) set('task_description', taskDescription);
  if (deadline !== undefined) set('task_deadline', deadline || null);
  if (priority !== undefined) set('task_priority', priority);
  if (progress !== undefined) set('task_progress', progress);
  if (status !== undefined) {
    set('task_status', status);
    // stamp / clear completion time on status transitions
    if (status === 'done' && existing.rows[0].task_status !== 'done') set('task_completed_at', new Date());
    if (status !== 'done' && existing.rows[0].task_status === 'done') set('task_completed_at', null);
  }
  if (fields.length === 0) throw new ApiError(400, 'No fields to update');

  values.push(taskId);
  await query(`UPDATE tasks SET ${fields.join(', ')} WHERE task_id = $${i}`, values);
  return res.status(200).json(new ApiResponse(200, await taskWithAssignees(taskId), 'Task updated'));
});

export const assignTask = asyncHandler(async (req, res) => {
  const { taskId } = req.params;
  const { userId } = req.body;
  if (!userId) throw new ApiError(400, 'userId is required');
  const task = await query('SELECT task_project_id, task_name FROM tasks WHERE task_id = $1', [taskId]);
  if (task.rowCount === 0) throw new ApiError(404, 'Task not found');
  await requireProjectAccess(task.rows[0].task_project_id, req.user.userId);

  await query(
    `INSERT INTO task_assignments (task_assignment_task_id, task_assignment_user_id)
     VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [taskId, userId]
  );
  await createNotification({
    userId,
    sourceUserId: req.user.userId,
    type: 'assignment',
    entityType: 'task',
    entityId: taskId,
    message: `${req.user.name} assigned you "${task.rows[0].task_name}"`,
  });
  return res.status(200).json(new ApiResponse(200, await taskWithAssignees(taskId), 'Task assigned'));
});

export const unassignTask = asyncHandler(async (req, res) => {
  const { taskId, userId } = req.params;
  const task = await query('SELECT task_project_id FROM tasks WHERE task_id = $1', [taskId]);
  if (task.rowCount === 0) throw new ApiError(404, 'Task not found');
  await requireProjectAccess(task.rows[0].task_project_id, req.user.userId);
  await query(
    'DELETE FROM task_assignments WHERE task_assignment_task_id = $1 AND task_assignment_user_id = $2',
    [taskId, userId]
  );
  return res.status(200).json(new ApiResponse(200, await taskWithAssignees(taskId), 'Task unassigned'));
});

export const deleteTask = asyncHandler(async (req, res) => {
  const { taskId } = req.params;
  const task = await query('SELECT task_project_id FROM tasks WHERE task_id = $1', [taskId]);
  if (task.rowCount === 0) throw new ApiError(404, 'Task not found');
  await requireProjectAccess(task.rows[0].task_project_id, req.user.userId);
  await query('DELETE FROM tasks WHERE task_id = $1', [taskId]);
  return res.status(200).json(new ApiResponse(200, { task_id: taskId }, 'Task deleted'));
});

export const getTaskById = asyncHandler(async (req, res) => {
  const task = await taskWithAssignees(req.params.taskId);
  if (!task) throw new ApiError(404, 'Task not found');
  await requireProjectAccess(task.task_project_id, req.user.userId);
  return res.status(200).json(new ApiResponse(200, task, 'OK'));
});

// Respects per-project task visibility: 'assignee_only' hides others' tasks
// from plain members (managers always see everything).
export const getTasksByProject = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const userId = req.user.userId;

  // one query for access + role + visibility (was 5-6 sequential round-trips)
  const ctx = await getProjectContext(projectId, userId);
  if (!ctx.hasAccess) throw new ApiError(403, 'You do not have access to this project');
  const restrict = ctx.task_visibility === 'assignee_only' && !ctx.isManager;

  const { rows } = await query(
    `SELECT t.*, ${assigneesSelect}
       FROM tasks t
       LEFT JOIN task_assignments ta ON ta.task_assignment_task_id = t.task_id
       LEFT JOIN users u ON u.user_id = ta.task_assignment_user_id
      WHERE t.task_project_id = $1
        AND ($3 = FALSE OR EXISTS (
          SELECT 1 FROM task_assignments me
           WHERE me.task_assignment_task_id = t.task_id AND me.task_assignment_user_id = $2))
      GROUP BY t.task_id
      ORDER BY t.task_created_at DESC`,
    [projectId, userId, restrict]
  );
  return res.status(200).json(new ApiResponse(200, rows, 'OK'));
});

const rangeCutoff = (range) =>
  range === 'week' ? "now() - interval '7 days'" : range === 'month' ? "now() - interval '30 days'" : null;

// My tasks with status + time-window filters (keeps "history" manageable).
// query: status=active|done|all (default active), range=week|month|all (for done; default month)
// History (status=done) merges live completed tasks with the archive of tasks
// whose project/company was deleted — so the record survives deletion.
export const getTasksByUser = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const status = ['active', 'done', 'all'].includes(req.query.status) ? req.query.status : 'active';
  const range = ['week', 'month', 'all'].includes(req.query.range) ? req.query.range : 'month';

  if (status === 'done') {
    const cutoff = rangeCutoff(range);
    const liveRange = cutoff ? `AND t.task_completed_at >= ${cutoff}` : '';
    const archRange = cutoff ? `AND h.history_completed_at >= ${cutoff}` : '';
    const { rows } = await query(
      `SELECT * FROM (
         SELECT t.task_id::text AS id, t.task_name, t.task_priority AS priority,
                t.task_completed_at AS completed_at, p.project_name,
                t.task_project_id::text AS project_id, FALSE AS archived
           FROM task_assignments ta
           JOIN tasks t ON t.task_id = ta.task_assignment_task_id
           JOIN projects p ON p.project_id = t.task_project_id
          WHERE ta.task_assignment_user_id = $1 AND t.task_status = 'done' ${liveRange}
         UNION ALL
         SELECT h.history_id::text AS id, h.history_task_name AS task_name, h.history_priority AS priority,
                h.history_completed_at AS completed_at,
                COALESCE(h.history_project_name,'(deleted project)')
                  || COALESCE(' · ' || h.history_cluster_name, '') AS project_name,
                NULL AS project_id, TRUE AS archived
           FROM task_history h
          WHERE h.history_user_id = $1 ${archRange}
       ) x
       ORDER BY completed_at DESC NULLS LAST`,
      [userId]
    );
    return res.status(200).json(new ApiResponse(200, rows, 'OK'));
  }

  const where = ['ta.task_assignment_user_id = $1', `t.task_status IN ('todo','in_progress')`];
  if (status === 'all') where[1] = 'TRUE';
  const { rows } = await query(
    `SELECT t.*, p.project_name, t.task_project_id::text AS project_id
       FROM task_assignments ta
       JOIN tasks t ON t.task_id = ta.task_assignment_task_id
       JOIN projects p ON p.project_id = t.task_project_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.task_deadline NULLS LAST`,
    [userId]
  );
  return res.status(200).json(new ApiResponse(200, rows, 'OK'));
});
