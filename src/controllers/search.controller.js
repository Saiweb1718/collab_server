import { query } from '../db/index.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Global search scoped to what the caller is allowed to see.
export const globalSearch = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const q = (req.query.q || '').trim();
  if (q.length < 2) {
    return res.status(200).json(new ApiResponse(200, { projects: [], tasks: [], people: [], messages: [] }, 'OK'));
  }
  const like = `%${q}%`;

  const [projects, tasks, people, messages] = await Promise.all([
    query(
      `SELECT DISTINCT p.project_id, p.project_name, c.cluster_id, c.cluster_name
         FROM projects p
         JOIN clusters c ON c.cluster_id = p.project_cluster_id
         JOIN cluster_members clm ON clm.cluster_member_cluster_id = c.cluster_id AND clm.cluster_member_user_id = $2
         LEFT JOIN project_members pm ON pm.project_member_project_id = p.project_id AND pm.project_member_user_id = $2
        WHERE p.project_name ILIKE $1
          AND (p.project_visibility = 'company' OR pm.project_member_user_id IS NOT NULL
               OR clm.cluster_member_role IN ('owner','admin'))
        LIMIT 8`,
      [like, userId]
    ),
    query(
      `SELECT DISTINCT t.task_id, t.task_name, t.task_status, p.project_id, p.project_name
         FROM tasks t
         JOIN projects p ON p.project_id = t.task_project_id
         JOIN project_members pm ON pm.project_member_project_id = p.project_id AND pm.project_member_user_id = $2
        WHERE (t.task_name ILIKE $1 OR t.task_description ILIKE $1)
        LIMIT 8`,
      [like, userId]
    ),
    query(
      `SELECT DISTINCT u.user_id, u.user_name, u.user_email, u.user_avatar_url, u.user_title
         FROM users u
         JOIN cluster_members cm1 ON cm1.cluster_member_user_id = u.user_id
         JOIN cluster_members cm2 ON cm2.cluster_member_cluster_id = cm1.cluster_member_cluster_id
        WHERE cm2.cluster_member_user_id = $2 AND u.user_id <> $2
          AND (u.user_name ILIKE $1 OR u.user_email ILIKE $1)
        LIMIT 8`,
      [like, userId]
    ),
    query(
      `SELECT m.message_id, m.message_text, m.message_time, m.message_chat_id,
              u.user_name AS sender_name
         FROM messages m
         JOIN chat_members cm ON cm.chat_member_chat_id = m.message_chat_id AND cm.chat_member_user_id = $2
         JOIN users u ON u.user_id = m.message_from_user_id
        WHERE m.message_is_deleted = FALSE AND m.message_text ILIKE $1
        ORDER BY m.message_time DESC
        LIMIT 8`,
      [like, userId]
    ),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      { projects: projects.rows, tasks: tasks.rows, people: people.rows, messages: messages.rows },
      'OK'
    )
  );
});
