import React, { useState } from 'react';
import "./Password.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEyeSlash } from "@fortawesome/free-solid-svg-icons";
import { faTrash } from "@fortawesome/free-solid-svg-icons";
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { decryptThePass, deleteAPassword } from "../../axios/instance";
import { delPass } from "../../redux/actions";
import { useDispatch } from "react-redux";

function Password({ id, name, password, email, iv })
{
    const [show, setShow] = useState(false);
    const [decPassword, setDecPassword] = useState("");

    const dispatch = useDispatch();

    const deletePassword = async (event) =>
    {
        if (event) {
            event.stopPropagation();
        }
        try
        {
            const res = await deleteAPassword({ id });

            if (res.status === 400)
            {
                toast.error(res.data.error, {
                    position: "top-right",
                    autoClose: 5000,
                    hideProgressBar: false,
                    closeOnClick: true,
                    pauseOnHover: true,
                    draggable: true,
                    progress: undefined,
                });
            }
            else if (res.status === 200)
            {
                dispatch(delPass(id));
                toast.success(res.data.message, {
                    position: "top-right",
                    autoClose: 5000,
                    hideProgressBar: false,
                    closeOnClick: true,
                    pauseOnHover: true,
                    draggable: true,
                    progress: undefined,
                });
            }
        }
        catch (err)
        {
            console.log(err)
        }

    }

    const decryptPassword = async () =>
    {
        try
        {
            if (!show)
            {
                const res = await decryptThePass({
                    iv: iv,
                    encryptedPassword: password,
                });

                if (res.status === 200)
                {
                    setDecPassword(res.data);
                    setShow(!show);
                    // Removed toast from here to avoid showing message in every password box
                }
            }
            else
            {
                setShow(!show);
            }

        }
        catch (error)
        {
            console.log(error);
        }
    }

    return (
        <div
            className="password"
            style={{
                position: "relative",
                width: "100%",
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
            }}
        >
            {/* Hide media section (icon/name) */}
            <div className="media" style={{ display: "none" }}></div>

            {/* Hide email display */}
            <div className="email" style={{ display: "none" }}></div>

            {/* Password box */}
            <div
                className="user-password"
                style={{
                    display: "flex",
                    alignItems: "center",
                    background: "rgba(255, 255, 255, 0.7)",
                    borderRadius: "16px",
                    border: "9px solid rgba(72, 187, 120, 0.3)",
                    overflow: "hidden",
                    transition: "all 0.3s ease",
                    cursor: "pointer",
                    overflowX: "auto",
                    whiteSpace: "nowrap"
                }}
                onClick={decryptPassword}
                onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "rgba(72, 187, 120, 0.5)";
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.9)";
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "rgba(72, 187, 120, 0.3)";
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.7)";
                }}
            >
                <input
                    type={show ? "text" : "password"}
                    value={decPassword || "••••••••"}
                    readOnly={true}
                    onClick={decryptPassword}
                    onFocus={(e) => e.target.select()}
                    style={{
                        flex: 1,
                        // padding: "0.7rem 2rem ",
                        outline: "none",
                        background: "transparent",
                        fontSize: "0.9rem",
                        fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', monospace",
                        transition: "all 0.3s ease",
                        color: show ? "#2d3748" : "#a0aec0",
                        fontWeight: show ? 600 : "normal",
                        letterSpacing: show ? "normal" : "2px",
                        display: "block",
                        maxWidth: "100%",
                        boxSizing: "border-box",
                        cursor: "text",
                        width: "100%",
                        minWidth: "0"
                    }}
                />
            </div>

            {/* Delete button */}
            <FontAwesomeIcon
                className="delete__btn1"
                onClick={deletePassword}
                icon={faTrash}
                style={{
                    position: "absolute",
                    top: "-8px",
                    right: "-8px",
                    background: "linear-gradient(45deg, #ef4444, #dc2626)",
                    border: "none",
                    borderRadius: "50%",
                    width: "32px",
                    height: "32px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    transition: "all 0.3s ease",
                    boxShadow: "0 2px 8px rgba(239, 68, 68, 0.3)",
                    zIndex: 5,
                    color: "white",
                    fontSize: "0.8rem"
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "scale(1.1)";
                    e.currentTarget.style.boxShadow = "0 4px 12px rgba(239, 68, 68, 0.4)";
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "scale(1)";
                    e.currentTarget.style.boxShadow = "0 2px 8px rgba(239, 68, 68, 0.3)";
                }}
            />
        </div>
    )
}

export default Password;
