import axios from "axios";

// Point the client at a different API with REACT_APP_API_URL at build time.
const url =
    process.env.REACT_APP_API_URL ||
    "https://password-manager-server-xxdr.onrender.com";

const instance = axios.create({
    baseURL: url,
    headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
    },
    withCredentials: true
});

export const API_URL = url;

export const checkAuthenticated = () => instance.get("/authenticate");
export const loginUser = (data) => instance.post("/login", data);
export const logoutUser = () => instance.get("/logout");
export const signupUser = (data) => instance.post("/register", data);
export const saveNewPassword = (data) => instance.post("/addnewpassword", data);
export const updateAPassword = (data) => instance.post("/updatepassword", data);
export const deleteAPassword = (id) => instance.post("/deletepassword", id);
export const decryptThePass = (data) => instance.post("/decrypt", data);

// Health probe used by the live status indicators (and by the cron job server side).
export const checkHealth = () => instance.get("/health", { withCredentials: false });
