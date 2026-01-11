-- Enable extensions if needed (Supabase has them enabled by default)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- For UUIDs, but we'll use SERIAL for simplicity

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Clusters Table
CREATE TABLE IF NOT EXISTS clusters (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50),
    company_chat_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Projects Table
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    cluster_id INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    chat_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast project lookup by cluster (optimizes O(log n) queries)
CREATE INDEX idx_projects_cluster_id ON projects(cluster_id);

-- 4. Tasks Table
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'done');

CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    deadline DATE,
    priority task_priority DEFAULT 'medium',
    progress INTEGER DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    status task_status DEFAULT 'todo',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Chats Table
CREATE TYPE chat_type AS ENUM ('project', 'company', 'dm');

CREATE TABLE IF NOT EXISTS chats (
    id SERIAL PRIMARY KEY,
    type chat_type NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add FKs to Clusters and Projects (after chats table exists)
ALTER TABLE clusters ADD FOREIGN KEY (company_chat_id) REFERENCES chats(id);
ALTER TABLE projects ADD FOREIGN KEY (chat_id) REFERENCES chats(id);

-- 6. Messages Table
CREATE TYPE message_type AS ENUM ('text', 'image', 'file');

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    from_user_id INTEGER NOT NULL REFERENCES users(id),
    to_user_id INTEGER REFERENCES users(id),
    text TEXT NOT NULL,
    time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    type message_type DEFAULT 'text',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast message retrieval
CREATE INDEX idx_messages_chat_id ON messages(chat_id);

-- 7. Notifications Table
CREATE TYPE notification_type AS ENUM ('mention', 'assignment');

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type notification_type NOT NULL,
    ref_id INTEGER NOT NULL, -- References message.id or task.id
    message VARCHAR(255) NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for user notifications
CREATE INDEX idx_notifications_user_id ON notifications(user_id);

-- 8. Cluster_Members Join Table
CREATE TYPE member_role AS ENUM ('owner', 'member');

CREATE TABLE IF NOT EXISTS cluster_members (
    cluster_id INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    role member_role NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cluster_id, user_id)
);

-- 9. Project_Members Join Table
CREATE TYPE project_role AS ENUM ('lead', 'member');

CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    role project_role DEFAULT 'member',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id)
);

-- 10. Task_Assignments Join Table
CREATE TABLE IF NOT EXISTS task_assignments (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (task_id, user_id)
);

-- 11. Optional: Chat_Members Join Table (if chats need explicit members)
CREATE TABLE IF NOT EXISTS chat_members (
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chat_id, user_id)
);