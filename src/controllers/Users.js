// write the user controllers u have read the schema and write all the controllers useful for users 
import { supabase } from '../utils/supabase.js';

//get all users
export async function getAllUsers(req, res) {
    const { data, error } = await supabase
        .from('users')
        .select('*');
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    return res.status(200).json(data);
}

//get user by id
export async function getUserById(req, res) {
    const { id } = req.params;
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', id);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    return res.status(200).json(data);
}

//create user
export async function createUser(req, res) {
    const { username, email, password } = req.body;
    const { data, error } = await supabase
        .from('users')
        .insert([{ username, email, password }]);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    return res.status(201).json(data);
}
//update user
export async function updateUser(req, res) {
    const { id } = req.params;
    const { username, email, password } = req.body;
    const { data, error } = await supabase.from('users').update({ username, email, password }).eq('id', id);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    return res.status(200).json(data);
}
//delete user
export async function deleteUser(req, res) {
    const { id } = req.params;
    const { data, error } = await supabase
        .from('users')
        .delete()
        .eq('id', id);
    if (error) {
        return res.status(500).json({ error: error.message });
    }   
    return res.status(200).json(data);
}
//login user
export async function loginUser(req, res) {
    const { email, password } = req.body;
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .eq('password', password); 
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    if (data.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }                       
    return res.status(200).json(data);
}
//logout user
export async function logoutUser(req, res) {
    // Since Supabase uses JWT for authentication, logging out is typically handled on the client side by removing the token.
    return res.status(200).json({ message: 'User logged out successfully' });
}
//reset password
export async function resetPassword(req, res) {
    const { email } = req.body;
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    if (data.length === 0) {
        return res.status(  404).json({ error: 'Email not found' });
    }
    return res.status(200).json(data);
}
//creating cluster of users
export async function createUserCluster(req, res) {
    const { users } = req.body; // users should be an array of user objects
    const { data, error } = await supabase
        .from('users')
        .insert(users);
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    return res.status(201).json(data);
}

