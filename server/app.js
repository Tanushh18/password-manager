const express = require("express");
const app = express();
const dotenv = require("dotenv");
const cors = require("cors");
const cookieParser = require('cookie-parser');  

const allowedOrigins = [
  'http://localhost:3000',
  'https://password-website.onrender.com'
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(cookieParser());   

// SETTING UP DOTENV
dotenv.config({ path: "./config.env" });

const PORT = process.env.PORT || 8000;

// CONNECTING WITH DATABASE
require("./db/connection");

app.use(express.json());


// LINKING THE ROUTER FILES 
app.use(require("./router/routing"));




// LISTENING TO PORT 
app.listen(PORT, () =>
{
    console.log(`listening to port : http://localhost:${PORT}/`)
})
