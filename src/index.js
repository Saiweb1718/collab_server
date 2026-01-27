import dotenv from 'dotenv'
import { app } from './app.js'
import connectToDb from './db/index.js'
dotenv.config({
    config:'./.env'
})
connectToDb().then(()=>{
    app.listen(process.env.PORT || 3000,()=>{
        console.log('urukuthunna');
    })
})
.catch((err)=>{
    console.log('connection fail ayindi' ,err);
})