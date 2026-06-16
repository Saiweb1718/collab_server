-- ============================================================
-- SAFE + RE-RUNNABLE FULL SCHEMA (PostgreSQL / Supabase)
-- All primary keys and foreign keys use UUID consistently.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 0. ENUM TYPES (idempotent)
-- ============================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_type') THEN
        CREATE TYPE chat_type AS ENUM ('project', 'company', 'direct');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_priority') THEN
        CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
        CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'done');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_type') THEN
        CREATE TYPE message_type AS ENUM ('text', 'image', 'file');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
        CREATE TYPE notification_type AS ENUM ('mention', 'assignment', 'message');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_role') THEN
        CREATE TYPE member_role AS ENUM ('admin', 'member');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_role') THEN
        CREATE TYPE project_role AS ENUM ('lead', 'member');
    END IF;
END $$;

-- ============================================================
-- generic updated_at trigger (works for any *_updated_at column,
-- column name passed as the trigger argument)
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW := json_populate_record(NEW, json_build_object(TG_ARGV[0], now()));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- helper that creates an updated_at trigger only if it does not exist
CREATE OR REPLACE FUNCTION ensure_updated_at_trigger(p_table TEXT, p_column TEXT)
RETURNS VOID AS $$
DECLARE
    trg_name TEXT := 'trg_' || p_table || '_set_updated_at';
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = trg_name AND tgrelid = p_table::regclass
    ) THEN
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at(%L)',
            trg_name, p_table, p_column
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_name VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) UNIQUE NOT NULL,
    user_password_hash TEXT NOT NULL,
    user_avatar_url TEXT,
    user_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_is_active BOOLEAN DEFAULT TRUE
);

-- ============================================================
-- 2. CHATS
-- ============================================================
CREATE TABLE IF NOT EXISTS chats (
    chat_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_type chat_type NOT NULL,
    chat_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    chat_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 3. CLUSTERS  (a "company"/workspace)
-- ============================================================
CREATE TABLE IF NOT EXISTS clusters (
    cluster_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cluster_name VARCHAR(255) NOT NULL,
    cluster_code VARCHAR(50) UNIQUE NOT NULL,
    cluster_company_chat_id UUID REFERENCES chats(chat_id) ON DELETE SET NULL,
    cluster_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cluster_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 4. PROJECTS
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
    project_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_cluster_id UUID NOT NULL REFERENCES clusters(cluster_id) ON DELETE CASCADE,
    project_name VARCHAR(255) NOT NULL,
    project_description TEXT,
    project_chat_id UUID UNIQUE REFERENCES chats(chat_id) ON DELETE SET NULL,
    project_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    project_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_projects_cluster_id ON projects(project_cluster_id);

-- ============================================================
-- 5. TASKS
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
    task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    task_name VARCHAR(255) NOT NULL,
    task_description TEXT,
    task_deadline DATE,
    task_priority task_priority DEFAULT 'medium',
    task_progress INTEGER DEFAULT 0 CHECK (task_progress BETWEEN 0 AND 100),
    task_status task_status DEFAULT 'todo',
    task_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    task_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(task_project_id);

-- ============================================================
-- 6. MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
    message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_chat_id UUID NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
    message_from_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    message_text TEXT,
    message_file_url TEXT,
    message_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    message_type message_type DEFAULT 'text',
    message_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    message_is_deleted BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(message_chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_from_user_id ON messages(message_from_user_id);

-- ============================================================
-- 7. MESSAGE READ RECEIPTS
-- ============================================================
CREATE TABLE IF NOT EXISTS message_read_receipts (
    receipt_message_id UUID NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
    receipt_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    receipt_delivered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    receipt_read_at TIMESTAMP,
    PRIMARY KEY (receipt_message_id, receipt_user_id)
);
CREATE INDEX IF NOT EXISTS idx_read_receipts_message_id ON message_read_receipts(receipt_message_id);
CREATE INDEX IF NOT EXISTS idx_read_receipts_user_id ON message_read_receipts(receipt_user_id);

-- ============================================================
-- 8. NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    notification_source_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    notification_entity_type VARCHAR(50),
    notification_entity_id UUID,
    notification_type notification_type NOT NULL,
    notification_message VARCHAR(255) NOT NULL,
    notification_is_read BOOLEAN DEFAULT FALSE,
    notification_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(notification_user_id);

-- ============================================================
-- 9. CLUSTER MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS cluster_members (
    cluster_member_cluster_id UUID NOT NULL REFERENCES clusters(cluster_id) ON DELETE CASCADE,
    cluster_member_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    cluster_member_role member_role NOT NULL DEFAULT 'member',
    cluster_member_joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cluster_member_cluster_id, cluster_member_user_id)
);
DROP INDEX IF EXISTS one_admin_per_cluster;
CREATE UNIQUE INDEX one_admin_per_cluster
    ON cluster_members(cluster_member_cluster_id)
    WHERE cluster_member_role = 'admin';
CREATE INDEX IF NOT EXISTS idx_cluster_members_user_id ON cluster_members(cluster_member_user_id);

-- ============================================================
-- 10. PROJECT MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS project_members (
    project_member_project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    project_member_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    project_member_role project_role DEFAULT 'member',
    project_member_joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_member_project_id, project_member_user_id)
);
DROP INDEX IF EXISTS one_lead_per_project;
CREATE UNIQUE INDEX one_lead_per_project
    ON project_members(project_member_project_id)
    WHERE project_member_role = 'lead';
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(project_member_user_id);

-- ============================================================
-- 11. TASK ASSIGNMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS task_assignments (
    task_assignment_task_id UUID NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    task_assignment_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    task_assignment_assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (task_assignment_task_id, task_assignment_user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_assignments_user_id ON task_assignments(task_assignment_user_id);

-- ============================================================
-- 12. CHAT MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_members (
    chat_member_chat_id UUID NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
    chat_member_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    chat_member_role member_role DEFAULT 'member',
    chat_member_joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chat_member_chat_id, chat_member_user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_members_user_id ON chat_members(chat_member_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_members_chat_id ON chat_members(chat_member_chat_id);

-- ============================================================
-- TRIGGERS for updated_at
-- ============================================================
SELECT ensure_updated_at_trigger('users',    'user_updated_at');
SELECT ensure_updated_at_trigger('chats',    'chat_updated_at');
SELECT ensure_updated_at_trigger('clusters', 'cluster_updated_at');
SELECT ensure_updated_at_trigger('projects', 'project_updated_at');
SELECT ensure_updated_at_trigger('tasks',    'task_updated_at');
SELECT ensure_updated_at_trigger('messages', 'message_updated_at');

-- ============================================================
-- v2: roles, visibility, join requests, mentions, profiles
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='request_status') THEN
    CREATE TYPE request_status AS ENUM ('pending','approved','rejected');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='project_visibility') THEN
    CREATE TYPE project_visibility AS ENUM ('members','company');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='task_visibility') THEN
    CREATE TYPE task_visibility AS ENUM ('all','assignee_only');
  END IF;
END $$;

ALTER TYPE member_role ADD VALUE IF NOT EXISTS 'owner';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'join_request';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'join_approved';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'join_rejected';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'project_invite';

ALTER TABLE users    ADD COLUMN IF NOT EXISTS user_bio TEXT;
ALTER TABLE users    ADD COLUMN IF NOT EXISTS user_title VARCHAR(255);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_visibility project_visibility DEFAULT 'members';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_task_visibility task_visibility DEFAULT 'all';
ALTER TABLE tasks    ADD COLUMN IF NOT EXISTS task_completed_at TIMESTAMP;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_is_edited BOOLEAN DEFAULT FALSE;

-- multiple admins per cluster, multiple leads per project
DROP INDEX IF EXISTS one_admin_per_cluster;
DROP INDEX IF EXISTS one_lead_per_project;

CREATE TABLE IF NOT EXISTS join_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  request_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  request_status request_status NOT NULL DEFAULT 'pending',
  request_message TEXT,
  request_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  request_decided_by UUID REFERENCES users(user_id) ON DELETE SET NULL,
  request_decided_at TIMESTAMP
);
DROP INDEX IF EXISTS uniq_pending_join_request;
CREATE UNIQUE INDEX uniq_pending_join_request
  ON join_requests(request_project_id, request_user_id)
  WHERE request_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_join_requests_project ON join_requests(request_project_id, request_status);
CREATE INDEX IF NOT EXISTS idx_join_requests_user ON join_requests(request_user_id);

CREATE TABLE IF NOT EXISTS message_mentions (
  mention_message_id UUID NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
  mention_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  PRIMARY KEY (mention_message_id, mention_user_id)
);
CREATE INDEX IF NOT EXISTS idx_message_mentions_user ON message_mentions(mention_user_id);

CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(message_chat_id, message_time DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(notification_user_id, notification_is_read);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(task_project_id, task_status);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(task_completed_at);

-- ============================================================
-- v3: completed-task archive (survives project/cluster deletion)
-- ============================================================
CREATE TABLE IF NOT EXISTS task_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  history_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  history_task_name VARCHAR(255) NOT NULL,
  history_project_name VARCHAR(255),
  history_cluster_name VARCHAR(255),
  history_priority task_priority DEFAULT 'medium',
  history_completed_at TIMESTAMP,
  history_archived_at TIMESTAMP DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_history_user
  ON task_history(history_user_id, history_completed_at DESC);
