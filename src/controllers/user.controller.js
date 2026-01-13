import express from "express"
import { Authorize, generatetoken } from "../middlewares/auth.middlewares.js";
export const SECRET = 'SECr3t'; 
import {supabase} from "../utils/supabase.js"
const router = express.Router()
import argon2 from "argon2"

router.post('/login',async (req,res)=>{
    const {email,password} = req.body;
    const {data,error} = await supabase
    .from('users')
    .select('*')
    .eq('email',email)
    // .eq('password_hash',password)

    if(error){
        return res.status(500).json({message:error})
    }
    if(data.length ===0){
        return res.status(401).json({message:"Invalid email"})
    }   
    if(data.length >0){
        console.log("user found:",data[0].password_hash)
            const isValid = await argon2.verify(
  data[0].password_hash,
  password
)   
        if (!isValid) {
    return res.status(401).json({ message: "Invalid Credentials" });
  }


        console.log("user logged in:",data)
        const token = generatetoken(data);
        res.cookie('authToken',token,{httpOnly:true,sameSite:'lax'});
        return res.status(200).json({message:"Login Successful"})
    }   
})

router.post('/signup',async (req,res)=>{
    const {name,password,email} = req.body;
    const {data,error} = await supabase
    .from('users')
    .select('*')
    .eq('email',email)
    if(error){
        return res.status(500).json({message:"Internal Server Error"})
    }   
    if(data.length >0){
        return res.status(409).json({message:"User Already Exists"})
    }
const hash = await argon2.hash(password, {
  type: argon2.argon2id
})

    const { data: insertData, error: insertError } = await supabase
    .from('users')
    .insert([{name:name,password_hash :hash,email:email}])
    .select();

    console.log(data,error)
    if(error){
        return res.status(500).json({message:insertError})
    }
    if(data){   
        console.log("user created:",data,insertData)
        const token = generatetoken(data);
        res.cookie('authToken',token,{httpOnly:true,sameSite:'lax'});
        return res.status(200).json({message:"Signup Successful"})
    }
})
router.get('/profile',Authorize,async (req,res)=>{
    const userId = req.headers.userid;
    console.log("profile user id =",userId)
    const {data,error} = await supabase
    .from('users')
    .select('*')
    .eq('id',userId)
    if(error){
        return res.status(500).json({message:"Internal Server Error"})
    }
    if(data.length ===0){
        return res.status(404).json({message:"User Not Found"})
    }
    if(data.length >0){
        console.log("user profile:",data)
        return res.status(200).json({profile:data[0]})
    }
})





export default router