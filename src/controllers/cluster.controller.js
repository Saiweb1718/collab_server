import { supabase } from "../utils/supabase";
import { randomUUID } from 'crypto';

const createCluster = async (req, res) => {
    try {
        const { clusterName, userId } = req.body;

        if (!clusterName || clusterName.trim() === "" || !userId) {
            return res.status(400).json({
                success: false,
                error: "Cluster name and user ID are required"
            });
        }

        const companyCode = randomUUID().slice(0, 8).toUpperCase();

        const { data: cluster, error: clusterError } = await supabase
            .from('clusters')
            .insert([{
                name: clusterName,
                code: companyCode
            }])
            .select()
            .single();

        if (clusterError) throw clusterError;

        const { data: ownership, error: ownershipError } = await supabase
            .from('cluster_members')
            .insert([{
                cluster_id: cluster.id,
                user_id: userId,
                role: 'admin'
            }])
            .select()
            .single();

        if (ownershipError) {
            await supabase.from('clusters').delete().eq('id', cluster.id);
            throw ownershipError;
        }
        return res.status(201).json({
            success: true,
            message: "Successfully created cluster",
            data: {
                cluster,
                membership: ownership
            }
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || "Error while creating cluster"
        });
    }
};
const deleteCluster = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({
                success: false,
                error: "Cluster ID is required"
            });
        }
        const { data, error } = await supabase
            .from('users')
            .delete()
            .eq('id', id)
            .select()
            .single();
        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    error: "Cluster not found"
                });
            }
            throw error;
        }
        return res.status(200).json({
            success: true,
            message: "Cluster deleted successfully",
            data
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || "Error while deleting cluster"
        });
    }
};
const joinCluster = async (req, res) => {
    try {
        const { clusterCode, userId } = req.body;

        if (!clusterCode || !userId) {
            return res.status(400).json({
                success: false,
                error: "Cluster code and user ID are required"
            });
        }

        const { data: cluster, error: clusterError } = await supabase
            .from('clusters')
            .select('id')
            .eq('code', clusterCode)
            .single();

        if (clusterError) {
            if (clusterError.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    error: "Cluster not found"
                });
            }
            throw clusterError;
        }

        const { data: membership, error: memberError } = await supabase
            .from('cluster_members')
            .insert([{
                cluster_id: cluster.id,
                user_id: userId,
                role: 'member'
            }])
            .select()
            .single();

        if (memberError) {
            if (memberError.code === '23505') {
                return res.status(400).json({
                    success: false,
                    error: "User already in this cluster"
                });
            }
            throw memberError;
        }
        return res.status(201).json({
            success: true,
            message: "Successfully joined cluster",
            data: membership
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || "Error joining cluster"
        });
    }
};
const getClusterDetails = async (req, res) => {
    try {
        const { clusterId } = req.params
        if (!clusterId) {
            return res.status(400).json({
                success: false,
                error: "Cluster ID is required"
            });
        }

        const {data,error}=await supabase.from('clusters').select('*').eq('id',clusterId).single();
        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    error: "Cluster not found"
                });
            }
            throw error;
        }
        return res.status(200).json({
            success:true,
            message:"cluster details vachinay",
            data
        })

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || "Error getting cluster"
        });

    }
}
const getClustersByUser = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({
                success: false,
                error: "User ID is required"
            });
        }

        const { data: memberships, error: memberError } = await supabase
            .from('cluster_members')
            .select(`
                role,
                joined_at,
                clusters (
                    id,
                    name,
                    code,
                    created_at,
                    cluster_members (count)
                )
            `)
            .eq('user_id', userId)
            .order('joined_at', { ascending: false });

        if (memberError) throw memberError;

        const clusters = memberships.map(m => ({
            ...m.clusters,
            userRole: m.role,
            joinedAt: m.joined_at,
            memberCount: m.clusters.cluster_members[0].count
        }));

        return res.status(200).json({
            success: true,
            count: clusters.length,
            data: clusters
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message || "Error fetching user clusters"
        });
    }
};
export {createCluster,deleteCluster,getClusterDetails,joinCluster,getClustersByUser}