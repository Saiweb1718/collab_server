import { supabase } from "../utils/supabase";
const createTask = async (req, res) => {
    try {
        const { projectId, taskName, taskDescription, deadline, priority, progress, assignId, status } = req.body;
        if (!projectId || !taskName || !assignId) {
            return res.status(400).json({
                success: false,
                error: "Project ID,AssignId and task name are required"
            });
        }
        const { data: task, error: taskError } = await supabase
            .from('tasks')
            .insert([{
                name: taskName,
                description: taskDescription,
                project_id: projectId,
                deadline: deadline,
                priority: priority || 'medium',
                progress: progress || 0,
                status: status || 'todo'
            }])
            .select()
            .single();

        if (taskError) throw taskError;

        if (assignId) {
            const { error: assignError } = await supabase
                .from('task_assignments')
                .insert([{
                    task_id: task.id,
                    user_id: assignId
                }]);

            if (assignError) {
                await supabase.from('tasks').delete().eq('id', task.id);
                throw assignError;
            }
        }

        return res.status(201).json({
            success: true,
            message: 'Task created successfully',
            data: task
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || "Error creating task"
        });
    }
};
const updateTask = async (req, res) => {
    try {
        const { taskId } = req.params;
        const { taskName, taskDescription, deadline, priority, progress, status } = req.body;

        if (!taskId) {
            return res.status(400).json({
                success: false,
                error: "Task ID is required"
            });
        }

        // Build update object (only include provided fields)
        const updates = {};
        if (taskName !== undefined) updates.name = taskName;
        if (taskDescription !== undefined) updates.description = taskDescription;
        if (deadline !== undefined) updates.deadline = deadline;
        if (priority !== undefined) updates.priority = priority;
        if (progress !== undefined) updates.progress = progress;
        if (status !== undefined) updates.status = status;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                error: "No fields to update"
            });
        }

        const { data: task, error: taskError } = await supabase
            .from('tasks')
            .update(updates)
            .eq('id', taskId)
            .select()
            .single();

        if (taskError) {
            if (taskError.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    error: "Task not found"
                });
            }
            throw taskError;
        }

        return res.status(200).json({
            success: true,
            message: 'Task updated successfully',
            data: task
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || "Error updating task"
        });
    }
};
const assignTask = async (req, res) => {
    try {
        const { taskId } = req.params;
        const { assignId } = req.body;

        if (!taskId || !assignId) {
            return res.status(400).json({
                success: false,
                error: "Task ID and user ID are required"
            });
        }

        const { data: task, error: taskError } = await supabase
            .from('tasks')
            .select('id')
            .eq('id', taskId)
            .single();

        if (taskError) {
            return res.status(404).json({
                success: false,
                error: "Task not found"
            });
        }

        const { data: assignment, error: assignError } = await supabase
            .from('task_assignments')
            .upsert({
                task_id: taskId,
                user_id: assignId
            }, {
                onConflict: 'task_id'
            })
            .select()
            .single();

        if (assignError) throw assignError;

        return res.status(200).json({
            success: true,
            message: 'Task assigned successfully',
            data: assignment
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || "Error assigning task"
        });
    }
};
const unassignTask = async (req, res) => {
    try {
        const { taskId } = req.params;

        if (!taskId) {
            return res.status(400).json({
                success: false,
                error: "Task ID is required"
            });
        }

        const { error } = await supabase
            .from('task_assignments')
            .delete()
            .eq('task_id', taskId);

        if (error) throw error;

        return res.status(200).json({
            success: true,
            message: 'Task unassigned successfully'
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || "Error unassigning task"
        });
    }
};
const deleteTask = async (req, res) => {
    try {
        const { taskId } = req.params;

        if (!taskId) {
            return res.status(400).json({
                success: false,
                error: "Task ID is required"
            });
        }
        const { data: task, error: taskError } = await supabase
            .from('tasks')
            .delete()
            .eq('id', taskId)
            .select()
            .single();

        if (taskError) {
            if (taskError.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    error: "Task not found"
                });
            }
            throw taskError;
        }

        return res.status(200).json({
            success: true,
            message: 'Task deleted successfully',
            data: task
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || "Error deleting task"
        });
    }
};
const getTaskById = async (req, res) => {
    try {
        const { taskId } = req.params;

        if (!taskId) {
            return res.status(400).json({
                success: false,
                error: "Task ID is required"
            });
        }

        const { data: task, error: taskError } = await supabase
            .from('tasks')
            .select(`
                *,
                task_assignments (
                    user_id
                )
            `)
            .eq('id', taskId)
            .single();

        if (taskError) {
            if (taskError.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    error: "Task not found"
                });
            }
            throw taskError;
        }

        return res.status(200).json({
            success: true,
            data: task
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || "Error fetching task"
        });
    }
};
const getTasksByProject = async (req, res) => {
    try {
        const { projectId } = req.params;

        if (!projectId) {
            return res.status(400).json({
                success: false,
                error: "Project ID is required"
            });
        }

        const { data: tasks, error: tasksError } = await supabase
            .from('tasks')
            .select(`
                *,
                task_assignments (
                    user_id
                )
            `)
            .eq('project_id', projectId)
            .order('created_at', { ascending: false });

        if (tasksError) throw tasksError;

        return res.status(200).json({
            success: true,
            count: tasks.length,
            data: tasks
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || "Error fetching tasks"
        });
    }
};
const getTasksByUser = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({
                success: false,
                error: "User ID is required"
            });
        }

        const { data: assignments, error: assignError } = await supabase
            .from('task_assignments')
            .select(`
                task_id,
                tasks (
                    *
                )
            `)
            .eq('user_id', userId);

        if (assignError) throw assignError;
        const tasks = assignments.map(a => a.tasks);

        return res.status(200).json({
            success: true,
            count: tasks.length,
            data: tasks
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || "Error fetching user tasks"
        });
    }
};

export {
    createTask,
    updateTask,
    assignTask,
    unassignTask,
    deleteTask,
    getTaskById,
    getTasksByProject,
    getTasksByUser
};