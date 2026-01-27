import { supabase } from '../utils/supabase.js';

export const create_project = async (req, res, next) => {
  try {
    const { cluster_id, name, description, user_id, project_chat_id } = req.body;

    if (!cluster_id || !name || !user_id || !project_chat_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: cluster_id, name, user_id, project_chat_id'
      });
    }

    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .insert({
        project_cluster_id: cluster_id,
        project_name: name,
        project_description: description,
        project_chat_id
      })
      .select()
      .single();

    if (projectError) throw projectError;

    const { data: memberData, error: memberError } = await supabase
      .from('project_members')
      .insert({
        project_member_project_id: projectData.project_id,
        project_member_user_id: user_id,
        project_member_role: 'lead'
      })
      .select()
      .single();

    if (memberError) throw memberError;

    res.status(201).json({ success: true, data: projectData });
  } catch (error) {
    console.error('Error creating project:', error);

    if (error.code === '23503') {
      return res.status(400).json({
        success: false,
        message: 'Invalid cluster_id or project_chat_id reference'
      });
    }
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'Project already exists or chat ID already associated'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating project'
    });
  }
};

export const join_project = async (req, res, next) => {
  try {
    const { project_id, user_id } = req.body;

    if (!project_id || !user_id) {
      return res.status(400).json({
        success: false,
        message: "project_id and user_id are required"
      });
    }

    const { data, error } = await supabase
      .from('project_members')
      .insert({
        project_member_project_id: project_id,
        project_member_user_id: user_id,
        project_member_role: 'member'
      })
      .select('project_member_project_id, project_member_user_id');

    if (error) throw error;

    return res.status(201).json({
      success: true,
      data
    });

  } catch (error) {
    console.error('Error joining project:', error);

    if (error.code === '23503') {
      return res.status(400).json({
        success: false,
        message: 'Invalid project_id or user_id'
      });
    }
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'User already a member of this project'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Error joining the project'
    });
  }
};

export const delete_project = async (req, res, next) => {
  try {
    const { project_id } = req.body;

    if (!project_id) {
      return res.status(400).json({
        success: false,
        message: 'project_id is required'
      });
    }

    const { data, error } = await supabase
      .from('projects')
      .delete()
      .eq('project_id', project_id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Project not found' });

    return res.status(200).json({
      success: true,
      message: 'Project and all members deleted successfully',
      data
    });

  } catch (error) {
    console.error('Error deleting project:', error);
    return res.status(500).json({ success: false, message: 'Error deleting project' });
  }
};

export const leave_project = async (req, res, next) => {
  try {
    const { project_id, user_id } = req.body;

    if (!project_id || !user_id) {
      return res.status(400).json({
        success: false,
        message: "project_id and user_id are required"
      });
    }

    const { data, error } = await supabase
      .from('project_members')
      .delete()
      .eq('project_member_project_id', project_id)
      .eq('project_member_user_id', user_id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'User not found in this project' });

    return res.status(200).json({
      success: true,
      message: "User has been removed from the project",
      data
    });

  } catch (error) {
    console.error("Error leaving project:", error);
    return res.status(500).json({ success: false, message: 'Error removing user from project' });
  }
};

export const get_project_details_by_user = async (req, res, next) => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "user_id is required" });
    }

    const { data, error } = await supabase
      .from('project_members')
      .select(`
        project_member_role,
        project_member_joined_at,
        projects (
          project_id,
          project_name,
          project_description,
          project_chat_id,
          project_created_at,
          clusters (
            cluster_id,
            cluster_name
          )
        )
      `)
      .eq('project_member_user_id', user_id);

    if (error) throw error;

    const projects = data.map(item => ({
      project_id: item.projects.project_id,
      project_name: item.projects.project_name,
      description: item.projects.project_description,
      chat_id: item.projects.project_chat_id,
      created_at: item.projects.project_created_at,
      cluster_id: item.projects.clusters.cluster_id,
      cluster_name: item.projects.clusters.cluster_name,
      role: item.project_member_role,
      joined_at: item.project_member_joined_at
    }));

    res.status(200).json({
      success: true,
      count: projects.length,
      data: projects
    });

  } catch (error) {
    console.error("Error fetching user projects:", error);
    res.status(500).json({ success: false, message: 'Error fetching user projects' });
  }
};
