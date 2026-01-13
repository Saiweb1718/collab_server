-- Enable extensions if needed
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- Optional if you want UUIDs

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    user_name VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) UNIQUE NOT NULL,
    user_password_hash TEXT NOT NULL,
    user_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_is_active BOOLEAN DEFAULT TRUE
);

-- 2. Chats Table (MOVED UP - must exist before clusters/projects)
CREATE TYPE chat_type AS ENUM ('project', 'company', 'direct');

CREATE TABLE IF NOT EXISTS chats (
    chat_id SERIAL PRIMARY KEY,
    chat_type chat_type NOT NULL,
    chat_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    chat_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Clusters Table
CREATE TABLE IF NOT EXISTS clusters (
    cluster_id SERIAL PRIMARY KEY,
    cluster_name VARCHAR(255) NOT NULL,
    cluster_code VARCHAR(50) UNIQUE NOT NULL,
    cluster_company_chat_id INTEGER REFERENCES chats(chat_id),
    cluster_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cluster_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Projects Table
CREATE TABLE IF NOT EXISTS projects (
    project_id SERIAL PRIMARY KEY,
    project_cluster_id INTEGER NOT NULL REFERENCES clusters(cluster_id) ON DELETE CASCADE,
    project_name VARCHAR(255) NOT NULL,
    project_description TEXT,
    project_chat_id INTEGER UNIQUE NOT NULL REFERENCES chats(chat_id),
    project_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    project_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast project lookup by cluster
CREATE INDEX idx_projects_cluster_id ON projects(project_cluster_id);

-- 5. Tasks Table
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'done');

CREATE TABLE IF NOT EXISTS tasks (
    task_id SERIAL PRIMARY KEY,
    task_project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    task_name VARCHAR(255) NOT NULL,
    task_description TEXT,
    task_deadline DATE,
    task_priority task_priority DEFAULT 'medium',
    task_progress INTEGER DEFAULT 0 CHECK (task_progress BETWEEN 0 AND 100),
    task_status task_status DEFAULT 'todo',
    task_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    task_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for tasks per project
CREATE INDEX idx_tasks_project_id ON tasks(task_project_id);

-- 6. Messages Table (FIXED - removed to_user_id)
CREATE TYPE message_type AS ENUM ('text', 'image', 'file');

CREATE TABLE IF NOT EXISTS messages (
    message_id SERIAL PRIMARY KEY,
    message_chat_id INTEGER NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
    message_from_user_id INTEGER NOT NULL REFERENCES users(user_id),
    message_text TEXT,
    message_file_url TEXT,
    message_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    message_type message_type DEFAULT 'text',
    message_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    message_is_deleted BOOLEAN DEFAULT FALSE
);

-- Index for fast message retrieval
CREATE INDEX idx_messages_chat_id ON messages(message_chat_id);
CREATE INDEX idx_messages_from_user_id ON messages(message_from_user_id);

-- 7. Message Read Receipts Table (NEW - with delivered_at)
CREATE TABLE IF NOT EXISTS message_read_receipts (
    receipt_message_id INTEGER NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
    receipt_user_id INTEGER NOT NULL REFERENCES users(user_id),
    receipt_delivered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    receipt_read_at TIMESTAMP,
    PRIMARY KEY (receipt_message_id, receipt_user_id)
);

-- Indexes for read receipts
CREATE INDEX idx_read_receipts_message_id ON message_read_receipts(receipt_message_id);
CREATE INDEX idx_read_receipts_user_id ON message_read_receipts(receipt_user_id);

-- 8. Notifications Table
CREATE TYPE notification_type AS ENUM ('mention', 'assignment');

CREATE TABLE IF NOT EXISTS notifications (
    notification_id SERIAL PRIMARY KEY,
    notification_user_id INTEGER NOT NULL REFERENCES users(user_id),
    notification_source_user_id INTEGER REFERENCES users(user_id),
    notification_entity_type VARCHAR(50), -- 'task' or 'message'
    notification_entity_id INTEGER,
    notification_type notification_type NOT NULL,
    notification_message VARCHAR(255) NOT NULL,
    notification_is_read BOOLEAN DEFAULT FALSE,
    notification_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for user notifications
CREATE INDEX idx_notifications_user_id ON notifications(notification_user_id);

-- 9. Cluster_Members Join Table
CREATE TYPE member_role AS ENUM ('admin', 'member');

CREATE TABLE IF NOT EXISTS cluster_members (
    cluster_member_cluster_id INTEGER NOT NULL REFERENCES clusters(cluster_id) ON DELETE CASCADE,
    cluster_member_user_id INTEGER NOT NULL REFERENCES users(user_id),
    cluster_member_role member_role NOT NULL,
    cluster_member_joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cluster_member_cluster_id, cluster_member_user_id)
);

-- Enforce exactly one admin per cluster
CREATE UNIQUE INDEX one_admin_per_cluster
ON cluster_members(cluster_member_cluster_id)
WHERE cluster_member_role = 'admin';

-- Index for fast user -> clusters lookup
CREATE INDEX idx_cluster_members_user_id ON cluster_members(cluster_member_user_id);

-- 10. Project_Members Join Table
CREATE TYPE project_role AS ENUM ('lead', 'member');

CREATE TABLE IF NOT EXISTS project_members (
    project_member_project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    project_member_user_id INTEGER NOT NULL REFERENCES users(user_id),
    project_member_role project_role DEFAULT 'member',
    project_member_joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_member_project_id, project_member_user_id)
);

-- Optional: enforce one lead per project
CREATE UNIQUE INDEX one_lead_per_project
ON project_members(project_member_project_id)
WHERE project_member_role = 'lead';

-- Index for fast user -> projects lookup
CREATE INDEX idx_project_members_user_id ON project_members(project_member_user_id);

-- 11. Task_Assignments Join Table
CREATE TABLE IF NOT EXISTS task_assignments (
    task_assignment_task_id INTEGER NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    task_assignment_user_id INTEGER NOT NULL REFERENCES users(user_id),
    task_assignment_assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (task_assignment_task_id, task_assignment_user_id)
);

-- Index for fast user -> tasks lookup
CREATE INDEX idx_task_assignments_user_id ON task_assignments(task_assignment_user_id);

-- 12. Chat_Members Join Table
CREATE TABLE IF NOT EXISTS chat_members (
    chat_member_chat_id INTEGER NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
    chat_member_user_id INTEGER NOT NULL REFERENCES users(user_id),
    chat_member_role member_role DEFAULT 'member',
    chat_member_joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chat_member_chat_id, chat_member_user_id)
);

-- Index for fast user -> chats lookup
CREATE INDEX idx_chat_members_user_id ON chat_members(chat_member_user_id);
CREATE INDEX idx_chat_members_chat_id ON chat_members(chat_member_chat_id);

-- ================================================================
-- HELPER QUERIES FOR READ RECEIPTS
-- ================================================================

-- Mark message as delivered to user
-- INSERT INTO message_read_receipts (receipt_message_id, receipt_user_id, receipt_delivered_at)
-- VALUES ($message_id, $user_id, CURRENT_TIMESTAMP)
-- ON CONFLICT (receipt_message_id, receipt_user_id) DO NOTHING;

-- Mark message as read by user
-- UPDATE message_read_receipts
-- SET receipt_read_at = CURRENT_TIMESTAMP
-- WHERE receipt_message_id = $message_id AND receipt_user_id = $user_id;

-- Get unread message count for a user in a chat
-- SELECT COUNT(DISTINCT m.message_id)
-- FROM messages m
-- JOIN chat_members cm ON cm.chat_member_chat_id = m.message_chat_id AND cm.chat_member_user_id = $user_id
-- LEFT JOIN message_read_receipts mrr ON mrr.receipt_message_id = m.message_id AND mrr.receipt_user_id = $user_id
-- WHERE m.message_chat_id = $chat_id
--   AND m.message_from_user_id != $user_id
--   AND mrr.receipt_read_at IS NULL;

-- Get delivery/read status for a specific message
-- SELECT u.user_id, u.user_name, mrr.receipt_delivered_at, mrr.receipt_read_at
-- FROM message_read_receipts mrr
-- JOIN users u ON u.user_id = mrr.receipt_user_id
-- WHERE mrr.receipt_message_id = $message_id
-- ORDER BY mrr.receipt_read_at DESC NULLS LAST;