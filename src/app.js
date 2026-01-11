import e from "express"
import cookieParser from "cookie-parser";
import cors from "cors";

const app = e();

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", process.env.CORS_ORIGIN);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    next();
});


app.use(cors({
    origin:process.env.CORS_ORIGIN,
    credentials:true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Authorization']
}));

app.use(e.json({limit:"32kb"}));
app.use(e.urlencoded({limit:"32kb",extended:true}));
app.use(cookieParser());


export {app}