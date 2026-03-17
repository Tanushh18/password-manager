import React, { useState, useEffect, useRef } from "react";
import { Link, useHistory } from "react-router-dom";
import img from "../../assets/images/login.jpg";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { loginUser } from "../../axios/instance";
import { useSelector, useDispatch } from "react-redux";
import { setAuth } from "../../redux/actions";

const styles = {
  page: {
    minHeight: "100vh",
    background: "#0d0b1a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem",
    position: "relative",
    overflow: "hidden",
    fontFamily: "'DM Sans', sans-serif",
  },
  auroraBlob1: {
    position: "absolute",
    width: "520px",
    height: "520px",
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(109,40,217,0.45) 0%, transparent 70%)",
    top: "-120px",
    left: "-100px",
    filter: "blur(50px)",
    animation: "aurora1 9s ease-in-out infinite",
    pointerEvents: "none",
  },
  auroraBlob2: {
    position: "absolute",
    width: "440px",
    height: "440px",
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(79,70,229,0.4) 0%, transparent 70%)",
    bottom: "-80px",
    right: "-80px",
    filter: "blur(55px)",
    animation: "aurora2 11s ease-in-out infinite",
    pointerEvents: "none",
  },
  auroraBlob3: {
    position: "absolute",
    width: "340px",
    height: "340px",
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(236,72,153,0.28) 0%, transparent 70%)",
    top: "42%",
    left: "50%",
    filter: "blur(50px)",
    animation: "aurora3 13s ease-in-out infinite",
    pointerEvents: "none",
  },
  grid: {
    position: "absolute",
    inset: 0,
    backgroundImage: "radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)",
    backgroundSize: "28px 28px",
    pointerEvents: "none",
  },
  card: {
    width: "100%",
    maxWidth: "860px",
    display: "flex",
    borderRadius: "24px",
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.08)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    background: "rgba(15,12,30,0.65)",
    boxShadow: "0 30px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
    animation: "fadeUp 0.7s ease both",
    position: "relative",
    zIndex: 1,
  },
  leftPanel: {
    flex: 1,
    padding: "3rem",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    animation: "fadeUp 0.8s ease 0.1s both",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    background: "rgba(139,92,246,0.15)",
    border: "1px solid rgba(139,92,246,0.3)",
    borderRadius: "50px",
    padding: "6px 14px",
    marginBottom: "1.2rem",
  },
  dot: {
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    background: "#a78bfa",
    boxShadow: "0 0 8px #a78bfa",
    animation: "pulse 2s infinite",
    display: "block",
    flexShrink: 0,
  },
  badgeText: {
    fontSize: "12px",
    color: "#c4b5fd",
    letterSpacing: "0.06em",
    fontWeight: 500,
  },
  heading: {
    fontFamily: "'Playfair Display', serif",
    fontSize: "2.2rem",
    color: "#fff",
    fontWeight: 700,
    lineHeight: 1.15,
    marginBottom: "0.5rem",
  },
  headingAccent: {
    background: "linear-gradient(135deg, #a78bfa, #818cf8, #e879f9)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    backgroundSize: "200% auto",
    animation: "shimmer 3s linear infinite",
    display: "block",
  },
  subtext: {
    fontSize: "0.9rem",
    color: "rgba(255,255,255,0.4)",
    fontWeight: 300,
    marginBottom: 0,
  },
  fieldGroup: {
    marginBottom: "1.2rem",
  },
  label: {
    display: "block",
    fontSize: "0.78rem",
    fontWeight: 500,
    color: "rgba(255,255,255,0.5)",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: "0.5rem",
  },
  input: {
    width: "100%",
    padding: "0.85rem 1.1rem",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "12px",
    color: "#fff",
    fontSize: "0.95rem",
    fontFamily: "'DM Sans', sans-serif",
    transition: "all 0.25s ease",
    outline: "none",
  },
  loginBtn: {
    width: "100%",
    padding: "1rem",
    background: "linear-gradient(135deg, #8b5cf6, #6366f1)",
    border: "none",
    borderRadius: "14px",
    color: "#fff",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer",
    letterSpacing: "0.02em",
    transition: "all 0.25s ease",
    boxShadow: "0 4px 20px rgba(139,92,246,0.4)",
    marginBottom: "1.4rem",
    animation: "pulse 2.5s infinite",
  },
  signupText: {
    textAlign: "center",
    fontSize: "0.85rem",
    color: "rgba(255,255,255,0.35)",
  },
  signupLink: {
    color: "#a78bfa",
    textDecoration: "none",
    fontWeight: 500,
  },
  rightPanel: {
    flex: 1,
    position: "relative",
    background: "linear-gradient(135deg, rgba(109,40,217,0.25) 0%, rgba(79,70,229,0.2) 50%, rgba(236,72,153,0.15) 100%)",
    borderLeft: "1px solid rgba(255,255,255,0.06)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "2.5rem",
    overflow: "hidden",
  },
  iconBox: {
    width: "80px",
    height: "80px",
    margin: "0 auto 1.5rem",
    background: "linear-gradient(135deg, rgba(139,92,246,0.3), rgba(99,102,241,0.3))",
    borderRadius: "24px",
    border: "1px solid rgba(139,92,246,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "2rem",
    backdropFilter: "blur(10px)",
  },
  featureCard: {
    display: "flex",
    alignItems: "center",
    gap: "0.7rem",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: "12px",
    padding: "0.7rem 1rem",
    marginBottom: "0.7rem",
  },
  featureIcon: {
    width: "28px",
    height: "28px",
    background: "rgba(139,92,246,0.2)",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.9rem",
    flexShrink: 0,
  },
  featureText: {
    fontSize: "0.82rem",
    color: "rgba(255,255,255,0.55)",
  },
};

function Login() {
  const isAuthenticated = useSelector((state) => state.isAuthenticated);
  const history = useHistory();
  const particlesRef = useRef(null);
  const [focusedField, setFocusedField] = useState(null);

  const [userData, setUserData] = useState({ email: "", password: "" });
  const dispatch = useDispatch();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setUserData((prevData) => ({ ...prevData, [name]: value }));
  };

  const handleLogin = async () => {
    try {
      const res = await loginUser(userData);
      if (res.status === 400) {
        toast.error(res.data.error, {
          position: "top-right",
          autoClose: 5000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          progress: undefined,
        });
      } else if (res.status === 200) {
        dispatch(setAuth(true));
        history.push("/");
      }
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    isAuthenticated && history.replace("/");
  }, [isAuthenticated, history]);

  // Inject keyframes
  useEffect(() => {
    const id = "login-keyframes";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Playfair+Display:wght@700&display=swap');
        @keyframes aurora1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(60px,-40px) scale(1.15)} }
        @keyframes aurora2 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-50px,50px) scale(1.2)} }
        @keyframes aurora3 { 0%,100%{transform:translate(0,0) scale(1)} 60%{transform:translate(40px,30px) scale(1.1)} }
        @keyframes float { 0%,100%{transform:translateY(0) rotate(0deg);opacity:.7} 50%{transform:translateY(-18px) rotate(180deg);opacity:.3} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { 0%{background-position:200% center} 100%{background-position:-200% center} }
        @keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(139,92,246,.35)} 70%{box-shadow:0 0 0 10px rgba(139,92,246,0)} }
      `;
      document.head.appendChild(style);
    }

    // Spawn floating particles
    if (particlesRef.current) {
      const colors = [
        "rgba(167,139,250,0.6)",
        "rgba(129,140,248,0.5)",
        "rgba(236,72,153,0.4)",
        "rgba(255,255,255,0.25)",
      ];
      for (let i = 0; i < 18; i++) {
        const p = document.createElement("div");
        const size = Math.random() * 4 + 2;
        p.style.cssText = `
          position:absolute;width:${size}px;height:${size}px;border-radius:50%;
          background:${colors[Math.floor(Math.random() * colors.length)]};
          left:${Math.random() * 100}%;top:${Math.random() * 100}%;
          animation:float ${5 + Math.random() * 8}s ease-in-out ${Math.random() * 5}s infinite;
          pointer-events:none;
        `;
        particlesRef.current.appendChild(p);
      }
    }
  }, []);

  const getInputStyle = (name) => ({
    ...styles.input,
    ...(focusedField === name
      ? {
          borderColor: "rgba(167,139,250,0.8)",
          boxShadow: "0 0 0 3px rgba(139,92,246,0.18), 0 0 20px rgba(139,92,246,0.12)",
          background: "rgba(255,255,255,0.06)",
        }
      : {}),
  });

  return (
    <div style={styles.page}>
      <ToastContainer
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />

      {/* Aurora blobs */}
      <div style={styles.auroraBlob1} />
      <div style={styles.auroraBlob2} />
      <div style={styles.auroraBlob3} />
      <div style={styles.grid} />

      {/* Floating particles */}
      <div
        ref={particlesRef}
        style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}
      />

      {/* Card */}
      <div style={styles.card}>
        {/* Left: form */}
        <div style={styles.leftPanel}>
          <div style={{ marginBottom: "2.5rem" }}>
            <div style={styles.badge}>
              <span style={styles.dot} />
              <span style={styles.badgeText}>SECURE LOGIN</span>
            </div>
            <h2 style={styles.heading}>
              Welcome
              <span style={styles.headingAccent}>back.</span>
            </h2>
            <p style={styles.subtext}>Your passwords, secured forever.</p>
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Email Address</label>
            <input
              type="email"
              placeholder="you@example.com"
              name="email"
              value={userData.email}
              onChange={handleChange}
              autoComplete="off"
              required
              style={getInputStyle("email")}
              onFocus={() => setFocusedField("email")}
              onBlur={() => setFocusedField(null)}
            />
          </div>

          <div style={{ ...styles.fieldGroup, marginBottom: "1.8rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <label style={{ ...styles.label, marginBottom: 0 }}>Password</label>
              <a href="#" style={{ fontSize: "0.78rem", color: "#a78bfa", textDecoration: "none", opacity: 0.85 }}>
                Forgot?
              </a>
            </div>
            <input
              type="password"
              placeholder="••••••••••"
              value={userData.password}
              onChange={handleChange}
              name="password"
              required
              style={getInputStyle("password")}
              onFocus={() => setFocusedField("password")}
              onBlur={() => setFocusedField(null)}
            />
          </div>

          <button
            onClick={handleLogin}
            style={styles.loginBtn}
            onMouseEnter={(e) => {
              e.target.style.transform = "translateY(-2px)";
              e.target.style.boxShadow = "0 8px 30px rgba(139,92,246,0.55)";
              e.target.style.background = "linear-gradient(135deg, #7c3aed, #4f46e5)";
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = "none";
              e.target.style.boxShadow = "0 4px 20px rgba(139,92,246,0.4)";
              e.target.style.background = "linear-gradient(135deg, #8b5cf6, #6366f1)";
            }}
          >
            Sign In →
          </button>

          <p style={styles.signupText}>
            Don't have an account?{" "}
            <Link to="/signup" style={styles.signupLink}>
              Sign up
            </Link>
          </p>
        </div>

        {/* Right: branding */}
        <div style={styles.rightPanel}>
          <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
            <div style={{ position: "absolute", width: "200px", height: "200px", borderRadius: "50%", border: "1px solid rgba(139,92,246,0.2)", top: "20px", right: "-60px", animation: "aurora1 8s ease-in-out infinite" }} />
            <div style={{ position: "absolute", width: "140px", height: "140px", borderRadius: "50%", border: "1px solid rgba(236,72,153,0.15)", bottom: "40px", left: "-30px", animation: "aurora2 10s ease-in-out infinite" }} />
          </div>

          <div style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
            <div style={styles.iconBox}>🔐</div>
            <h3 style={{ fontFamily: "'Playfair Display', serif", fontSize: "1.6rem", color: "#fff", fontWeight: 700, marginBottom: "0.8rem", lineHeight: 1.3 }}>
              Your vault,<br />always safe
            </h3>
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.4)", lineHeight: 1.75, maxWidth: "220px", margin: "0 auto" }}>
              Military-grade encryption protects every password you store with us.
            </p>
            <div style={{ marginTop: "2rem" }}>
              <div style={{ ...styles.featureCard }}>
                <div style={{ ...styles.featureIcon }}>🛡️</div>
                <span style={styles.featureText}>AES-256 encryption</span>
              </div>
              <div style={{ ...styles.featureCard, marginBottom: 0 }}>
                <div style={{ ...styles.featureIcon, background: "rgba(99,102,241,0.2)" }}>⚡</div>
                <span style={styles.featureText}>Instant sync across devices</span>
              </div>
            </div>
          </div>

          
            href="https://www.freepik.com/vectors/star"
            target="_blank"
            rel="noreferrer"
            style={{ position: "absolute", bottom: "1rem", fontSize: "0.65rem", color: "rgba(255,255,255,0.2)", textDecoration: "none" }}
          >
            Star vector by vectorpouch – freepik.com
          </a>
        </div>
      </div>
    </div>
  );
}

export default Login;
