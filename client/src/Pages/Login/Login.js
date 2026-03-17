import React, { useState, useEffect, useRef } from "react";
import { Link, useHistory } from "react-router-dom";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { loginUser } from "../../axios/instance";
import { useSelector, useDispatch } from "react-redux";
import { setAuth } from "../../redux/actions";

/* ─────────────────────────────────────────────
   KEYFRAMES + GLOBAL STYLES (injected once)
───────────────────────────────────────────── */
const KEYFRAMES = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Playfair+Display:wght@700&display=swap');

  @keyframes aurora1 {
    0%,100% { transform: translate(0,0) scale(1); }
    50%      { transform: translate(60px,-40px) scale(1.15); }
  }
  @keyframes aurora2 {
    0%,100% { transform: translate(0,0) scale(1); }
    50%      { transform: translate(-50px,50px) scale(1.2); }
  }
  @keyframes aurora3 {
    0%,100% { transform: translate(0,0) scale(1); }
    60%      { transform: translate(40px,30px) scale(1.1); }
  }
  @keyframes float {
    0%,100% { transform: translateY(0) rotate(0deg); opacity:0.7; }
    50%      { transform: translateY(-18px) rotate(180deg); opacity:0.3; }
  }
  @keyframes fadeUp {
    from { opacity:0; transform:translateY(20px); }
    to   { opacity:1; transform:translateY(0); }
  }
  @keyframes shimmer {
    0%   { background-position:200% center; }
    100% { background-position:-200% center; }
  }
  @keyframes pulse {
    0%,100% { box-shadow:0 0 0 0 rgba(139,92,246,0.35); }
    70%      { box-shadow:0 0 0 10px rgba(139,92,246,0); }
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @keyframes dotBounce {
    0%,80%,100% { transform: scale(0); opacity:0.3; }
    40%          { transform: scale(1);   opacity:1; }
  }
  @keyframes shake {
    0%,100% { transform: translateX(0); }
    15%      { transform: translateX(-8px); }
    30%      { transform: translateX(8px); }
    45%      { transform: translateX(-6px); }
    60%      { transform: translateX(6px); }
    75%      { transform: translateX(-3px); }
    90%      { transform: translateX(3px); }
  }
  @keyframes successPop {
    0%   { transform: scale(0.8); opacity:0; }
    60%  { transform: scale(1.1); }
    100% { transform: scale(1);   opacity:1; }
  }
  @keyframes progressBar {
    0%   { width: 0%; }
    20%  { width: 25%; }
    50%  { width: 55%; }
    80%  { width: 78%; }
    100% { width: 95%; }
  }
  @keyframes ripple {
    0%   { transform: scale(0); opacity:0.6; }
    100% { transform: scale(4); opacity:0; }
  }
  @keyframes glow {
    0%,100% { box-shadow: 0 0 20px rgba(139,92,246,0.3); }
    50%      { box-shadow: 0 0 40px rgba(139,92,246,0.7), 0 0 60px rgba(99,102,241,0.4); }
  }
  @keyframes serverPing {
    0%   { transform: scale(1);   opacity:1; }
    50%  { transform: scale(1.4); opacity:0.5; }
    100% { transform: scale(1);   opacity:1; }
  }
  @keyframes typewriter {
    from { width: 0; }
    to   { width: 100%; }
  }
  @keyframes blink {
    0%,100% { opacity:1; }
    50%      { opacity:0; }
  }
  @keyframes slideInRight {
    from { transform: translateX(20px); opacity:0; }
    to   { transform: translateX(0);    opacity:1; }
  }
  @keyframes checkmark {
    0%   { stroke-dashoffset: 50; }
    100% { stroke-dashoffset: 0; }
  }
  @keyframes borderFlow {
    0%   { background-position: 0% 50%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }

  .login-input:focus {
    border-color: rgba(167,139,250,0.8) !important;
    box-shadow: 0 0 0 3px rgba(139,92,246,0.18), 0 0 20px rgba(139,92,246,0.12) !important;
    background: rgba(255,255,255,0.06) !important;
  }
  .login-input.error {
    border-color: rgba(239,68,68,0.8) !important;
    box-shadow: 0 0 0 3px rgba(239,68,68,0.15) !important;
    animation: shake 0.5s ease !important;
  }
  .login-input.success {
    border-color: rgba(34,197,94,0.8) !important;
    box-shadow: 0 0 0 3px rgba(34,197,94,0.15) !important;
  }
  .login-btn:not(:disabled):hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(139,92,246,0.55) !important;
    background: linear-gradient(135deg, #7c3aed, #4f46e5) !important;
  }
  .login-btn:not(:disabled):active {
    transform: translateY(0px) scale(0.98);
  }
  .login-btn:disabled {
    cursor: not-allowed;
    opacity: 0.85;
  }
`;

/* ─────────────────────────────────────────────
   STATUS CONFIG
───────────────────────────────────────────── */
const STATUS = {
  idle:        { color: "#a78bfa", label: "SECURE LOGIN" },
  waking:      { color: "#f59e0b", label: "WAKING SERVER…" },
  connecting:  { color: "#60a5fa", label: "CONNECTING…" },
  verifying:   { color: "#a78bfa", label: "VERIFYING…" },
  success:     { color: "#4ade80", label: "ACCESS GRANTED" },
  error:       { color: "#f87171", label: "LOGIN FAILED" },
};

/* ─────────────────────────────────────────────
   COMPONENT
───────────────────────────────────────────── */
function Login() {
  const isAuthenticated = useSelector((s) => s.isAuthenticated);
  const history         = useHistory();
  const dispatch        = useDispatch();
  const particlesRef    = useRef(null);
  const rippleRef       = useRef(null);
  const btnRef          = useRef(null);

  const [userData, setUserData] = useState({ email: "", password: "" });
  const [focusedField, setFocusedField]   = useState(null);
  const [loadingStage, setLoadingStage]   = useState("idle"); // idle | waking | connecting | verifying | success | error
  const [fieldErrors, setFieldErrors]     = useState({ email: "", password: "" });
  const [fieldValid,  setFieldValid]      = useState({ email: false, password: false });
  const [showPass,    setShowPass]        = useState(false);
  const [statusMsg,   setStatusMsg]       = useState("");
  const [attempt,     setAttempt]         = useState(0); // tracks shake re-trigger

  const isLoading = ["waking","connecting","verifying"].includes(loadingStage);

  /* ── inject keyframes ── */
  useEffect(() => {
    if (!document.getElementById("login-kf")) {
      const s = document.createElement("style");
      s.id = "login-kf";
      s.textContent = KEYFRAMES;
      document.head.appendChild(s);
    }
  }, []);

  /* ── spawn particles ── */
  useEffect(() => {
    if (!particlesRef.current) return;
    const colors = ["rgba(167,139,250,0.6)","rgba(129,140,248,0.5)","rgba(236,72,153,0.4)","rgba(255,255,255,0.25)"];
    for (let i = 0; i < 22; i++) {
      const p   = document.createElement("div");
      const sz  = Math.random() * 4 + 2;
      p.style.cssText = `
        position:absolute; width:${sz}px; height:${sz}px; border-radius:50%;
        background:${colors[Math.floor(Math.random()*colors.length)]};
        left:${Math.random()*100}%; top:${Math.random()*100}%;
        animation:float ${5+Math.random()*8}s ease-in-out ${Math.random()*5}s infinite;
        pointer-events:none;
      `;
      particlesRef.current.appendChild(p);
    }
  }, []);

  /* ── redirect if already authed ── */
  useEffect(() => {
    isAuthenticated && history.replace("/");
  }, [isAuthenticated, history]);

  /* ── real-time validation ── */
  const validateField = (name, value) => {
    if (name === "email") {
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      setFieldErrors(p => ({ ...p, email: value && !ok ? "Enter a valid email address" : "" }));
      setFieldValid(p => ({ ...p, email: value.length > 0 && ok }));
    }
    if (name === "password") {
      const ok = value.length >= 6;
      setFieldErrors(p => ({ ...p, password: value && !ok ? "Password must be at least 6 characters" : "" }));
      setFieldValid(p => ({ ...p, password: value.length >= 6 }));
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setUserData(p => ({ ...p, [name]: value }));
    validateField(name, value);
  };

  /* ── ripple effect on button click ── */
  const triggerRipple = (e) => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const ripple = document.createElement("span");
    ripple.style.cssText = `
      position:absolute; left:${x}px; top:${y}px;
      width:20px; height:20px; border-radius:50%;
      background:rgba(255,255,255,0.35);
      transform:translate(-50%,-50%);
      animation:ripple 0.6s ease-out forwards;
      pointer-events:none;
    `;
    btnRef.current.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);
  };

  /* ── login handler with staged loading ── */
  const handleLogin = async (e) => {
    if (e) triggerRipple(e);

    // client-side validation before hitting server
    let hasError = false;
    if (!userData.email) {
      setFieldErrors(p => ({ ...p, email: "Email is required" }));
      hasError = true;
    }
    if (!userData.password) {
      setFieldErrors(p => ({ ...p, password: "Password is required" }));
      hasError = true;
    }
    if (hasError) {
      setAttempt(a => a + 1);
      setLoadingStage("error");
      setTimeout(() => setLoadingStage("idle"), 1500);
      return;
    }

    try {
      // Stage 1 – waking server
      setLoadingStage("waking");
      setStatusMsg("Waking up server, please wait…");
      await delay(900);

      // Stage 2 – connecting
      setLoadingStage("connecting");
      setStatusMsg("Establishing secure connection…");
      await delay(600);

      // Stage 3 – verifying
      setLoadingStage("verifying");
      setStatusMsg("Verifying your credentials…");

      const res = await loginUser(userData);

      if (res.status === 400) {
        setLoadingStage("error");
        setAttempt(a => a + 1);
        const msg = res.data?.error || "Invalid email or password.";
        setStatusMsg(msg);
        toast.error(msg, toastOpts);
        setTimeout(() => { setLoadingStage("idle"); setStatusMsg(""); }, 2500);

      } else if (res.status === 200) {
        setLoadingStage("success");
        setStatusMsg("Login successful! Redirecting…");
        await delay(1200);
        dispatch(setAuth(true));
        history.push("/");

      } else {
        throw new Error("Unexpected response");
      }
    } catch (err) {
      const msg = err.message?.includes("Network") || err.code === "ERR_NETWORK"
        ? "Cannot reach server. Please try again."
        : "Something went wrong. Please try again.";
      setLoadingStage("error");
      setAttempt(a => a + 1);
      setStatusMsg(msg);
      toast.error(msg, toastOpts);
      setTimeout(() => { setLoadingStage("idle"); setStatusMsg(""); }, 2500);
    }
  };

  /* ── Enter key support ── */
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !isLoading) handleLogin(e);
  };

  /* ── derived status ── */
  const statusCfg = STATUS[loadingStage] || STATUS.idle;

  return (
    <div style={S.page} onKeyDown={handleKeyDown}>
      <ToastContainer position="top-right" autoClose={5000} hideProgressBar={false}
        newestOnTop closeOnClick rtl={false} pauseOnFocusLoss draggable pauseOnHover
        theme="dark"
      />

      {/* Aurora blobs */}
      <div style={S.blob1} />
      <div style={S.blob2} />
      <div style={S.blob3} />
      <div style={S.grid} />

      {/* Particles */}
      <div ref={particlesRef} style={S.particles} />

      {/* Card */}
      <div style={S.card}>

        {/* ── LEFT: Form ── */}
        <div style={S.leftPanel}>

          {/* Progress bar (loading) */}
          {isLoading && (
            <div style={S.progressTrack}>
              <div style={S.progressFill} />
            </div>
          )}

          {/* Badge / status */}
          <div style={{ marginBottom: "2.5rem" }}>
            <div style={{ ...S.badge, borderColor: `${statusCfg.color}55`, background: `${statusCfg.color}18` }}>
              <StatusDot stage={loadingStage} color={statusCfg.color} />
              <span style={{ ...S.badgeText, color: statusCfg.color }}>
                {statusCfg.label}
              </span>
              {loadingStage === "waking" && <ServerPingDots />}
            </div>
            <h2 style={S.heading}>
              Welcome
              <span style={S.accent}>back.</span>
            </h2>
            <p style={S.subtext}>Your passwords, secured forever.</p>
          </div>

          {/* Status message */}
          {statusMsg && (
            <div style={{
              ...S.statusBanner,
              background: loadingStage === "error"
                ? "rgba(239,68,68,0.12)"
                : loadingStage === "success"
                ? "rgba(34,197,94,0.12)"
                : "rgba(139,92,246,0.12)",
              borderColor: loadingStage === "error"
                ? "rgba(239,68,68,0.3)"
                : loadingStage === "success"
                ? "rgba(34,197,94,0.3)"
                : "rgba(139,92,246,0.3)",
              color: loadingStage === "error" ? "#f87171"
                : loadingStage === "success"  ? "#4ade80"
                : "#c4b5fd",
            }}>
              {loadingStage === "success" ? "✓ " : loadingStage === "error" ? "✕ " : "⟳ "}
              {statusMsg}
            </div>
          )}

          {/* Email */}
          <div style={S.fieldGroup}>
            <label style={S.label}>Email Address</label>
            <div style={{ position: "relative" }}>
              <input
                className={`login-input${fieldErrors.email ? " error" : fieldValid.email ? " success" : ""}`}
                type="email"
                placeholder="you@example.com"
                name="email"
                value={userData.email}
                onChange={handleChange}
                autoComplete="off"
                required
                disabled={isLoading}
                style={S.input}
                onFocus={() => setFocusedField("email")}
                onBlur={() => setFocusedField(null)}
              />
              {fieldValid.email && !fieldErrors.email && (
                <span style={S.fieldIcon}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" stroke="#4ade80" strokeWidth="1.5"/>
                    <path d="M5 8l2 2 4-4" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                      style={{ strokeDasharray:10, strokeDashoffset:0, animation:"checkmark 0.3s ease forwards" }}
                    />
                  </svg>
                </span>
              )}
              {fieldErrors.email && (
                <span style={S.fieldIcon}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" stroke="#f87171" strokeWidth="1.5"/>
                    <path d="M8 5v4M8 11v.5" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </span>
              )}
            </div>
            {fieldErrors.email && (
              <p style={S.errorMsg}>{fieldErrors.email}</p>
            )}
          </div>

          {/* Password */}
          <div style={{ ...S.fieldGroup, marginBottom: "1.8rem" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"0.5rem" }}>
              <label style={{ ...S.label, marginBottom:0 }}>Password</label>
              <a href="#" style={S.forgotLink}>Forgot?</a>
            </div>
            <div style={{ position:"relative" }}>
              <input
                className={`login-input${fieldErrors.password ? " error" : fieldValid.password ? " success" : ""}`}
                type={showPass ? "text" : "password"}
                placeholder="••••••••••"
                value={userData.password}
                onChange={handleChange}
                name="password"
                required
                disabled={isLoading}
                style={{ ...S.input, paddingRight:"3rem" }}
                onFocus={() => setFocusedField("password")}
                onBlur={() => setFocusedField(null)}
              />
              {/* show/hide toggle */}
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                style={S.eyeBtn}
                tabIndex={-1}
              >
                {showPass ? "🙈" : "👁️"}
              </button>
            </div>
            {fieldErrors.password && (
              <p style={S.errorMsg}>{fieldErrors.password}</p>
            )}
          </div>

          {/* Login Button */}
          <button
            ref={btnRef}
            onClick={handleLogin}
            disabled={isLoading}
            style={{
              ...S.loginBtn,
              ...(loadingStage === "success" ? { background:"linear-gradient(135deg,#16a34a,#15803d)" } : {}),
              ...(loadingStage === "error"   ? { background:"linear-gradient(135deg,#dc2626,#b91c1c)" } : {}),
              position:"relative", overflow:"hidden",
            }}
          >
            {isLoading ? (
              <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:"10px" }}>
                <Spinner />
                <span>{loadingStage === "waking" ? "Waking server…" : loadingStage === "connecting" ? "Connecting…" : "Verifying…"}</span>
              </span>
            ) : loadingStage === "success" ? (
              <span>✓ Success!</span>
            ) : loadingStage === "error" ? (
              <span>Try Again →</span>
            ) : (
              <span>Sign In →</span>
            )}
          </button>

          {/* Server wake notice */}
          {loadingStage === "waking" && (
            <div style={S.wakeNotice}>
              <ServerIcon />
              <span>Free-tier server is waking up — this may take ~10 seconds on first login.</span>
            </div>
          )}

          {/* Signup */}
          <p style={S.signupText}>
            Don't have an account?{" "}
            <Link to="/signup" style={S.signupLink}>Sign up</Link>
          </p>
        </div>

        {/* ── RIGHT: Branding ── */}
        <div style={S.rightPanel}>
          <div style={{ position:"absolute", inset:0, overflow:"hidden", pointerEvents:"none" }}>
            <div style={{ position:"absolute", width:"200px", height:"200px", borderRadius:"50%",
              border:"1px solid rgba(139,92,246,0.2)", top:"20px", right:"-60px",
              animation:"aurora1 8s ease-in-out infinite" }}
            />
            <div style={{ position:"absolute", width:"140px", height:"140px", borderRadius:"50%",
              border:"1px solid rgba(236,72,153,0.15)", bottom:"40px", left:"-30px",
              animation:"aurora2 10s ease-in-out infinite" }}
            />
          </div>

          <div style={{ textAlign:"center", position:"relative", zIndex:1 }}>
            <div style={{
              ...S.iconBox,
              animation: isLoading ? "glow 1.5s ease-in-out infinite" : "none",
            }}>
              {loadingStage === "success" ? "✅" : loadingStage === "error" ? "🔓" : "🔐"}
            </div>
            <h3 style={S.vaultTitle}>Your vault,<br />always safe</h3>
            <p style={S.vaultDesc}>
              Military-grade encryption protects every password you store with us.
            </p>

            {/* Live server status indicator */}
            <LiveStatus stage={loadingStage} />

            <div style={{ marginTop:"1.5rem" }}>
              <div style={S.featureCard}>
                <div style={S.featureIcon}>🛡️</div>
                <span style={S.featureText}>AES-256 encryption</span>
              </div>
              <div style={{ ...S.featureCard, marginBottom:0 }}>
                <div style={{ ...S.featureIcon, background:"rgba(99,102,241,0.2)" }}>⚡</div>
                <span style={S.featureText}>Instant sync across devices</span>
              </div>
            </div>
          </div>

          <a href="https://www.freepik.com/vectors/star" target="_blank" rel="noreferrer" style={S.attribution}>
            Star vector by vectorpouch – freepik.com
          </a>
        </div>

      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   SUB-COMPONENTS
───────────────────────────────────────────── */

function StatusDot({ stage, color }) {
  return (
    <span style={{
      width:"7px", height:"7px", borderRadius:"50%",
      background: color,
      boxShadow: `0 0 8px ${color}`,
      display:"block", flexShrink:0,
      animation: stage === "idle" || stage === "error" ? "pulse 2s infinite"
        : stage === "success" ? "none"
        : "serverPing 1s ease-in-out infinite",
    }} />
  );
}

function Spinner() {
  return (
    <span style={{
      width:"16px", height:"16px", borderRadius:"50%",
      border:"2px solid rgba(255,255,255,0.25)",
      borderTopColor:"#fff",
      display:"inline-block",
      animation:"spin 0.7s linear infinite",
      flexShrink:0,
    }} />
  );
}

function ServerPingDots() {
  return (
    <span style={{ display:"flex", gap:"3px", alignItems:"center", marginLeft:"4px" }}>
      {[0,1,2].map(i => (
        <span key={i} style={{
          width:"4px", height:"4px", borderRadius:"50%",
          background:"#f59e0b",
          animation:`dotBounce 1.2s ease-in-out ${i*0.2}s infinite`,
          display:"block",
        }} />
      ))}
    </span>
  );
}

function ServerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0, marginTop:"1px" }}>
      <rect x="2" y="3" width="20" height="7" rx="2" stroke="#f59e0b" strokeWidth="1.5"/>
      <rect x="2" y="14" width="20" height="7" rx="2" stroke="#f59e0b" strokeWidth="1.5"/>
      <circle cx="6" cy="6.5" r="1" fill="#f59e0b"/>
      <circle cx="6" cy="17.5" r="1" fill="#f59e0b"/>
    </svg>
  );
}

function LiveStatus({ stage }) {
  const map = {
    idle:       { icon:"🟢", text:"Server online",         color:"#4ade80" },
    waking:     { icon:"🟡", text:"Server waking up…",     color:"#fbbf24" },
    connecting: { icon:"🔵", text:"Establishing tunnel…",  color:"#60a5fa" },
    verifying:  { icon:"🟣", text:"Authenticating…",       color:"#a78bfa" },
    success:    { icon:"🟢", text:"Authenticated!",         color:"#4ade80" },
    error:      { icon:"🔴", text:"Auth failed",            color:"#f87171" },
  };
  const cfg = map[stage] || map.idle;
  return (
    <div style={{
      display:"inline-flex", alignItems:"center", gap:"6px",
      background:"rgba(0,0,0,0.25)", border:`1px solid ${cfg.color}33`,
      borderRadius:"50px", padding:"5px 12px", marginTop:"1.2rem",
      animation:"slideInRight 0.3s ease",
    }}>
      <span style={{ fontSize:"9px", animation: stage !== "idle" && stage !== "error" && stage !== "success" ? "serverPing 1s infinite" : "none" }}>
        {cfg.icon}
      </span>
      <span style={{ fontSize:"0.72rem", color:cfg.color, fontWeight:500 }}>{cfg.text}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
const delay = (ms) => new Promise(r => setTimeout(r, ms));

const toastOpts = {
  position:"top-right", autoClose:5000, hideProgressBar:false,
  closeOnClick:true, pauseOnHover:true, draggable:true,
};

/* ─────────────────────────────────────────────
   STYLES
───────────────────────────────────────────── */
const S = {
  page: {
    minHeight:"100vh", background:"#0d0b1a",
    display:"flex", alignItems:"center", justifyContent:"center",
    padding:"2rem", position:"relative", overflow:"hidden",
    fontFamily:"'DM Sans', sans-serif",
  },
  blob1: {
    position:"absolute", width:"520px", height:"520px", borderRadius:"50%",
    background:"radial-gradient(circle, rgba(109,40,217,0.45) 0%, transparent 70%)",
    top:"-120px", left:"-100px", filter:"blur(50px)",
    animation:"aurora1 9s ease-in-out infinite", pointerEvents:"none",
  },
  blob2: {
    position:"absolute", width:"440px", height:"440px", borderRadius:"50%",
    background:"radial-gradient(circle, rgba(79,70,229,0.4) 0%, transparent 70%)",
    bottom:"-80px", right:"-80px", filter:"blur(55px)",
    animation:"aurora2 11s ease-in-out infinite", pointerEvents:"none",
  },
  blob3: {
    position:"absolute", width:"340px", height:"340px", borderRadius:"50%",
    background:"radial-gradient(circle, rgba(236,72,153,0.28) 0%, transparent 70%)",
    top:"42%", left:"50%", filter:"blur(50px)",
    animation:"aurora3 13s ease-in-out infinite", pointerEvents:"none",
  },
  grid: {
    position:"absolute", inset:0,
    backgroundImage:"radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)",
    backgroundSize:"28px 28px", pointerEvents:"none",
  },
  particles: { position:"absolute", inset:0, pointerEvents:"none", overflow:"hidden" },
  card: {
    width:"100%", maxWidth:"860px", display:"flex",
    borderRadius:"24px", overflow:"hidden",
    border:"1px solid rgba(255,255,255,0.08)",
    backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)",
    background:"rgba(15,12,30,0.65)",
    boxShadow:"0 30px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
    animation:"fadeUp 0.7s ease both", position:"relative", zIndex:1,
  },
  leftPanel: {
    flex:1, padding:"3rem", display:"flex", flexDirection:"column",
    justifyContent:"center", animation:"fadeUp 0.8s ease 0.1s both", position:"relative",
  },
  progressTrack: {
    position:"absolute", top:0, left:0, right:0, height:"2px",
    background:"rgba(255,255,255,0.06)", borderRadius:"2px 2px 0 0",
  },
  progressFill: {
    height:"100%", borderRadius:"2px",
    background:"linear-gradient(90deg, #8b5cf6, #6366f1, #e879f9)",
    animation:"progressBar 8s ease forwards",
  },
  badge: {
    display:"inline-flex", alignItems:"center", gap:"8px",
    borderRadius:"50px", padding:"6px 14px", marginBottom:"1.2rem",
    border:"1px solid", transition:"all 0.4s ease",
  },
  badgeText: { fontSize:"12px", letterSpacing:"0.06em", fontWeight:500 },
  heading: {
    fontFamily:"'Playfair Display', serif", fontSize:"2.2rem",
    color:"#fff", fontWeight:700, lineHeight:1.15, marginBottom:"0.5rem",
  },
  accent: {
    background:"linear-gradient(135deg, #a78bfa, #818cf8, #e879f9)",
    WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
    backgroundClip:"text", backgroundSize:"200% auto",
    animation:"shimmer 3s linear infinite", display:"block",
  },
  subtext: { fontSize:"0.9rem", color:"rgba(255,255,255,0.4)", fontWeight:300, marginBottom:0 },
  statusBanner: {
    padding:"0.65rem 1rem", borderRadius:"10px", border:"1px solid",
    fontSize:"0.82rem", fontWeight:500, marginBottom:"1rem",
    animation:"slideInRight 0.3s ease", lineHeight:1.5,
  },
  fieldGroup: { marginBottom:"1.2rem" },
  label: {
    display:"block", fontSize:"0.78rem", fontWeight:500,
    color:"rgba(255,255,255,0.5)", letterSpacing:"0.08em",
    textTransform:"uppercase", marginBottom:"0.5rem",
  },
  input: {
    width:"100%", padding:"0.85rem 1.1rem",
    background:"rgba(255,255,255,0.04)",
    border:"1px solid rgba(255,255,255,0.1)",
    borderRadius:"12px", color:"#fff", fontSize:"0.95rem",
    fontFamily:"'DM Sans', sans-serif", transition:"all 0.25s ease",
    outline:"none", boxSizing:"border-box",
  },
  fieldIcon: {
    position:"absolute", right:"12px", top:"50%",
    transform:"translateY(-50%)", display:"flex", alignItems:"center",
  },
  errorMsg: {
    margin:"0.35rem 0 0", fontSize:"0.75rem", color:"#f87171",
    animation:"slideInRight 0.25s ease", display:"flex", alignItems:"center", gap:"4px",
  },
  eyeBtn: {
    position:"absolute", right:"12px", top:"50%", transform:"translateY(-50%)",
    background:"none", border:"none", cursor:"pointer", fontSize:"14px",
    padding:"2px", lineHeight:1, opacity:0.6,
  },
  forgotLink: { fontSize:"0.78rem", color:"#a78bfa", textDecoration:"none", opacity:0.85 },
  loginBtn: {
    width:"100%", padding:"1rem",
    background:"linear-gradient(135deg, #8b5cf6, #6366f1)",
    border:"none", borderRadius:"14px", color:"#fff",
    fontSize:"1rem", fontWeight:600, cursor:"pointer",
    letterSpacing:"0.02em", transition:"all 0.25s ease",
    boxShadow:"0 4px 20px rgba(139,92,246,0.4)", marginBottom:"1rem",
  },
  wakeNotice: {
    display:"flex", alignItems:"flex-start", gap:"8px",
    background:"rgba(245,158,11,0.1)", border:"1px solid rgba(245,158,11,0.25)",
    borderRadius:"10px", padding:"0.65rem 0.9rem",
    fontSize:"0.75rem", color:"#fbbf24", lineHeight:1.5,
    marginBottom:"1rem", animation:"slideInRight 0.3s ease",
  },
  signupText: { textAlign:"center", fontSize:"0.85rem", color:"rgba(255,255,255,0.35)", margin:0 },
  signupLink: { color:"#a78bfa", textDecoration:"none", fontWeight:500 },
  rightPanel: {
    flex:1, position:"relative",
    background:"linear-gradient(135deg, rgba(109,40,217,0.25) 0%, rgba(79,70,229,0.2) 50%, rgba(236,72,153,0.15) 100%)",
    borderLeft:"1px solid rgba(255,255,255,0.06)",
    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
    padding:"2.5rem", overflow:"hidden",
  },
  iconBox: {
    width:"80px", height:"80px", margin:"0 auto 1.5rem",
    background:"linear-gradient(135deg, rgba(139,92,246,0.3), rgba(99,102,241,0.3))",
    borderRadius:"24px", border:"1px solid rgba(139,92,246,0.4)",
    display:"flex", alignItems:"center", justifyContent:"center",
    fontSize:"2rem", backdropFilter:"blur(10px)",
    transition:"all 0.4s ease",
  },
  vaultTitle: {
    fontFamily:"'Playfair Display', serif", fontSize:"1.6rem",
    color:"#fff", fontWeight:700, marginBottom:"0.8rem", lineHeight:1.3,
  },
  vaultDesc: {
    fontSize:"0.85rem", color:"rgba(255,255,255,0.4)",
    lineHeight:1.75, maxWidth:"220px", margin:"0 auto",
  },
  featureCard: {
    display:"flex", alignItems:"center", gap:"0.7rem",
    background:"rgba(255,255,255,0.04)",
    border:"1px solid rgba(255,255,255,0.07)",
    borderRadius:"12px", padding:"0.7rem 1rem", marginBottom:"0.7rem",
  },
  featureIcon: {
    width:"28px", height:"28px", background:"rgba(139,92,246,0.2)",
    borderRadius:"8px", display:"flex", alignItems:"center",
    justifyContent:"center", fontSize:"0.9rem", flexShrink:0,
  },
  featureText: { fontSize:"0.82rem", color:"rgba(255,255,255,0.55)" },
  attribution: {
    position:"absolute", bottom:"1rem", fontSize:"0.65rem",
    color:"rgba(255,255,255,0.2)", textDecoration:"none",
  },
};

export default Login;
