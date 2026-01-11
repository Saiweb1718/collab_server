

export const SECRET = 'SECr3t'; 
import jwt from "jsonwebtoken"  
import  { Request, Response ,NextFunction} from "express";
export const generatetoken=(user )=>{
    return  jwt.sign({userid:user},SECRET,{expiresIn:"1h"})
    }
    
export const Authorize  =(req,res,next)=>{
    const authHeader =req.headers.cookie?.split('; ')
    .find(row => row.startsWith('authToken='))
console.log("user = =  =",authHeader)
    if(authHeader){
        const token = authHeader.split("authToken=")[1]
console.log(token)
    jwt.verify(token,SECRET,(err,data)=>{
        if(err){
            console.log(err)
            return res.sendStatus(403);
        }
        if (!data) {
            console.log('1',data)
            return res.sendStatus(403);
          }
        else{
            if(typeof data ==="string"){
                console.log('2',data)
                return res.sendStatus(403)
         
            }
            else{     
                console.log('3',data)
                   req.headers.userid = data.userid._id;
                next();
            
            }
        }
    })
    }else{
        res.sendStatus(403)
    }
}