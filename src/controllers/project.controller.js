// import { request } from "express"
import { supabase } from '../utils/supabase.js';



export const create_project = async(req, res, next) => {
    try {
        const {cluster_id, name, description,user_id} = req.body;
        
      
        if (!cluster_id || !name) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required fields: cluster_id, name are required' 
            });
        }
        
        const { data, error } = await supabase
            .from('projects')
            .insert({ cluster_id, name, description, chat_id })
            .select('id, cluster_id, name, description, chat_id')
            .single(); // Returns single object instead of array

        if (error) {
            throw error;
        }
        
        res.status(201).json({ success: true, data });
    } catch (error) {
        console.error('Error creating project:', error);
        
        // Handle specific error types
        if (error.code === '23503') { // Foreign key violation
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid cluster_id or chat_id reference' 
            });
        }
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ 
                success: false, 
                message: 'Chat ID already associated with another project' 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Error creating project' 
        });
    }
};

export const delete_project = async

delete,update ,get_projectsby_user, , add_mem

export const add_task = async(req, res, next) => {
    const {project_id, name, description, deadline, priority} = req.body;

    try {

        if (!project_id || !name) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required fields: project_id and name are required' 
            });
        }

        const {data, error} = await supabase
            .from('tasks') // Should be 'tasks' not 'projects'
            .insert({
                project_id,
                name,
                description,
                deadline,
                priority
                // progress and status will use DB defaults (0 and 'todo')
            })
            .select()
            .single();

        if (error) {
            throw error;
        }

        res.status(201).json({ success: true, data });

    } catch (error) {
        console.error('Error creating task:', error);
        
        if (error.code === '23503') {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid project_id reference' 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Error creating task' 
        });
    }
};

