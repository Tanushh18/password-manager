import React, { useEffect, useState, useRef } from "react";
import { useHistory } from "react-router";
import Password from "../../Components/Password/Password";
import "./Passwords.css";
import "react-responsive-modal/styles.css";
import { Modal } from "react-responsive-modal";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { saveNewPassword, checkAuthenticated } from "../../axios/instance";
import { useSelector, useDispatch } from "react-redux";
import { setAuth, setPasswords } from "../../redux/actions";
import * as XLSX from "xlsx";

function Passwords() {
  const [platform, setPlatform] = useState("");
  const [platEmail, setPlatEmail] = useState("");
  const [platPass, setPlatPass] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [newPass, setNewPass] = useState("");
  const [open, setOpen] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const particlesRef = useRef(null);

  const history = useHistory();

  const { isAuthenticated, name, email, passwords } = useSelector(
    (state) => state
  );
  const dispatch = useDispatch();

  const clean = (val) => {
    if (!val) return "";
    return val.toString().replace(/\u00A0/g, "").replace(/\s+/g, " ").trim();
  };

  const verifyUser = async () => {
    try {
      const res = await checkAuthenticated();
      if (res.status === 400) {
        dispatch(setAuth(false));
      } else {
        const { passwords } = res.data;
        dispatch(setPasswords(passwords));
      }
    } catch (error) {
      console.log(error);
    }
  };

  const addNewPassword = async (e) => {
    e.preventDefault();
    try {
      const data = {
        platform: clean(platform) || "NA",
        userPass: clean(platPass) || "NA",
        platEmail: clean(platEmail) || "NA",
        userEmail: clean(email),
      };
      const res = await saveNewPassword(data);
      if (res.status === 400) {
        toast.error(res.data.error, { position: "top-right" });
      } else if (res.status === 200) {
        setOpen(false);
        verifyUser();
        toast.success(res.data.message, { position: "top-right" });
        setPlatform("");
        setPlatEmail("");
        setPlatPass("");
      }
    } catch (error) {
      console.log(error);
    }
  };

  const handleEditPassword = async (id, platform, platEmail) => {
    try {
      const data = {
        platform: clean(platform) || "NA",
        userPass: clean(newPass) || "NA",
        platEmail: clean(platEmail) || "NA",
        userEmail: clean(email),
      };
      const res = await saveNewPassword(data);
      if (res.status === 200) {
        toast.success("Password updated");
        setEditingId(null);
        verifyUser();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleExcelUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      for (const row of jsonData) {
        const payload = {
          platform: clean(row.platform || row.Platform) || "NA",
          userPass: clean(row.userPass || row.password || row.Password) || "NA",
          platEmail: clean(row.platEmail || row.email || row.Email) || "NA",
          userEmail: clean(email),
        };
        try {
          await saveNewPassword(payload);
        } catch (err) {
          console.error("Error saving row:", row, err);
        }
      }
      verifyUser();
      toast.success("Bulk passwords uploaded", {
        position: "top-right",
        autoClose: 5000,
      });
    };
    reader.readAsArrayBuffer(file);
  };

  useEffect(() => {
    !isAuthenticated && history.replace("/signin");
  }, [isAuthenticated, history]);

  // Inject keyframes + Google Fonts once
  useEffect(() => {
    const id = "passwords-keyframes";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Playfair+Display:wght@700&display=swap');
        @keyframes aurora1 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(70px,-50px) scale(1.15); }
        }
        @keyframes aurora2 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(-60px,60px) scale(1.2); }
        }
        @keyframes aurora3 {
          0%,100% { transform: translate(0,0) scale(1); }
          60%      { transform: translate(50px,30px) scale(1.1); }
        }
        @keyframes float {
          0%,100% { transform: translateY(0) rotate(0deg); opacity: 0.6; }
          50%      { transform: translateY(-20px) rotate(180deg); opacity: 0.2; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0%   { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes pulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(139,92,246,0.35); }
          70%      { box-shadow: 0 0 0 10px rgba(139,92,246,0); }
        }
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.95) translateY(20px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `;
      document.head.appendChild(style);
    }

    // Floating particles
    if (particlesRef.current && particlesRef.current.children.length === 0) {
      const colors = [
        "rgba(167,139,250,0.55)",
        "rgba(129,140,248,0.45)",
        "rgba(236,72,153,0.35)",
        "rgba(255,255,255,0.2)",
      ];
      for (let i = 0; i < 22; i++) {
        const p = document.createElement("div");
        const size = Math.random() * 4 + 2;
        p.style.cssText = `
          position:absolute;
          width:${size}px; height:${size}px;
          border-radius:50%;
          background:${colors[Math.floor(Math.random() * colors.length)]};
          left:${Math.random() * 100}%;
          top:${Math.random() * 100}%;
          animation: float ${6 + Math.random() * 8}s ease-in-out ${Math.random() * 6}s infinite;
          pointer-events:none;
        `;
        particlesRef.current.appendChild(p);
      }
    }
  }, []);

  const inputStyle = (name) => ({
    width: "100%",
    padding: "0.85rem 1.1rem",
    background: "rgba(255,255,255,0.05)",
    border: `1px solid ${focusedField === name ? "rgba(167,139,250,0.8)" : "rgba(255,255,255,0.12)"}`,
    borderRadius: "12px",
    color: "#fff",
    fontSize: "0.95rem",
    fontFamily: "'DM Sans', sans-serif",
    outline: "none",
    transition: "all 0.25s ease",
    boxSizing: "border-box",
    boxShadow: focusedField === name
      ? "0 0 0 3px rgba(139,92,246,0.18), 0 0 20px rgba(139,92,246,0.1)"
      : "none",
  });

  const platformInitial = (name) => {
    if (!name || name === "NA") return "?";
    return name.charAt(0).toUpperCase();
  };

  const gradients = [
    "linear-gradient(135deg, #8b5cf6, #6366f1)",
    "linear-gradient(135deg, #ec4899, #8b5cf6)",
    "linear-gradient(135deg, #06b6d4, #6366f1)",
    "linear-gradient(135deg, #f59e0b, #ef4444)",
    "linear-gradient(135deg, #10b981, #06b6d4)",
    "linear-gradient(135deg, #f97316, #ec4899)",
  ];

  const getGradient = (str) => {
    if (!str) return gradients[0];
    const code = str.charCodeAt(0) % gradients.length;
    return gradients[code];
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0d0b1a",
        padding: "2rem",
        fontFamily: "'DM Sans', sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <ToastContainer />

      {/* ── Aurora blobs ── */}
      <div
        style={{
          position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", width: "600px", height: "600px", borderRadius: "50%", background: "radial-gradient(circle, rgba(109,40,217,0.4) 0%, transparent 70%)", top: "-150px", left: "-120px", filter: "blur(60px)", animation: "aurora1 10s ease-in-out infinite" }} />
        <div style={{ position: "absolute", width: "500px", height: "500px", borderRadius: "50%", background: "radial-gradient(circle, rgba(79,70,229,0.35) 0%, transparent 70%)", bottom: "-100px", right: "-100px", filter: "blur(65px)", animation: "aurora2 12s ease-in-out infinite" }} />
        <div style={{ position: "absolute", width: "380px", height: "380px", borderRadius: "50%", background: "radial-gradient(circle, rgba(236,72,153,0.25) 0%, transparent 70%)", top: "40%", left: "55%", filter: "blur(55px)", animation: "aurora3 14s ease-in-out infinite" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
      </div>

      {/* ── Particles ── */}
      <div ref={particlesRef} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }} />

      {/* ── Page content ── */}
      <div style={{ maxWidth: "1200px", margin: "0 auto", position: "relative", zIndex: 1 }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "3rem", animation: "fadeUp 0.7s ease both" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)", borderRadius: "50px", padding: "6px 16px", marginBottom: "1.2rem" }}>
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#a78bfa", boxShadow: "0 0 8px #a78bfa", animation: "pulse 2s infinite", display: "block" }} />
            <span style={{ fontSize: "12px", color: "#c4b5fd", letterSpacing: "0.06em", fontWeight: 500 }}>VAULT</span>
          </div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: "clamp(2rem, 5vw, 3rem)", color: "#fff", fontWeight: 700, margin: "0 0 0.5rem", lineHeight: 1.15 }}>
            Welcome back,{" "}
            <span style={{ background: "linear-gradient(135deg, #a78bfa, #818cf8, #e879f9)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", backgroundSize: "200% auto", animation: "shimmer 3s linear infinite" }}>
              {name}
            </span>
          </h1>
          <p style={{ fontSize: "1rem", color: "rgba(255,255,255,0.4)", fontWeight: 300, margin: 0 }}>
            {passwords?.length || 0} password{passwords?.length !== 1 ? "s" : ""} stored securely
          </p>
        </div>

        {/* Action row */}
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center", marginBottom: "2.5rem", animation: "fadeUp 0.7s ease 0.1s both" }}>
          <button
            onClick={() => setOpen(true)}
            style={{ background: "linear-gradient(135deg, #8b5cf6, #6366f1)", color: "#fff", border: "none", borderRadius: "14px", padding: "0.85rem 1.8rem", fontSize: "0.95rem", fontWeight: 600, cursor: "pointer", transition: "all 0.25s ease", boxShadow: "0 4px 20px rgba(139,92,246,0.4)", display: "flex", alignItems: "center", gap: "0.5rem", letterSpacing: "0.01em" }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 28px rgba(139,92,246,0.55)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(139,92,246,0.4)"; }}
          >
            + Add Password
          </button>

          <label
            style={{ background: "rgba(255,255,255,0.07)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)", borderRadius: "14px", padding: "0.85rem 1.8rem", fontSize: "0.95rem", fontWeight: 600, cursor: "pointer", transition: "all 0.25s ease", display: "flex", alignItems: "center", gap: "0.5rem", letterSpacing: "0.01em" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(139,92,246,0.15)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.transform = "none"; }}
          >
            ↑ Upload Excel
            <input type="file" accept=".xlsx, .xls" style={{ display: "none" }} onChange={handleExcelUpload} />
          </label>
        </div>

        {/* Search */}
        <div style={{ maxWidth: "600px", margin: "0 auto 2.5rem", animation: "fadeUp 0.7s ease 0.15s both" }}>
          <input
            type="text"
            placeholder="Search by platform..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: "100%",
              padding: "0.95rem 1.3rem",
              fontSize: "0.97rem",
              border: `1px solid ${focusedField === "search" ? "rgba(167,139,250,0.8)" : "rgba(255,255,255,0.1)"}`,
              borderRadius: "14px",
              background: "rgba(255,255,255,0.05)",
              backdropFilter: "blur(10px)",
              color: "#fff",
              outline: "none",
              transition: "all 0.25s ease",
              boxSizing: "border-box",
              fontFamily: "'DM Sans', sans-serif",
              boxShadow: focusedField === "search" ? "0 0 0 3px rgba(139,92,246,0.18)" : "none",
            }}
            onFocus={() => setFocusedField("search")}
            onBlur={() => setFocusedField(null)}
          />
        </div>

        {/* ── Modal ── */}
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          styles={{
            overlay: { background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" },
            modal: {
              background: "rgba(18,14,36,0.97)",
              backdropFilter: "blur(30px)",
              borderRadius: "24px",
              border: "1px solid rgba(139,92,246,0.25)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
              padding: "0",
              maxWidth: "480px",
              width: "90%",
              animation: "modalIn 0.3s ease both",
            },
          }}
        >
          <div style={{ padding: "2.5rem" }}>
            {/* Modal header */}
            <div style={{ marginBottom: "2rem", textAlign: "center" }}>
              <div style={{ width: "52px", height: "52px", background: "linear-gradient(135deg, rgba(139,92,246,0.3), rgba(99,102,241,0.3))", borderRadius: "16px", border: "1px solid rgba(139,92,246,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", margin: "0 auto 1rem" }}>🔑</div>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: "1.7rem", fontWeight: 700, color: "#fff", margin: 0 }}>Add New Password</h2>
              <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.35)", margin: "0.4rem 0 0" }}>Stored with end-to-end encryption</p>
            </div>

            <form style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
              {/* Platform */}
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, color: "rgba(255,255,255,0.5)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.5rem" }}>Platform</label>
                <input
                  type="text"
                  placeholder="e.g. Facebook"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  style={inputStyle("m-platform")}
                  onFocus={() => setFocusedField("m-platform")}
                  onBlur={() => setFocusedField(null)}
                />
              </div>

              {/* Email */}
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, color: "rgba(255,255,255,0.5)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.5rem" }}>Email</label>
                <input
                  type="text"
                  placeholder="e.g. you@example.com"
                  value={platEmail}
                  onChange={(e) => setPlatEmail(e.target.value)}
                  style={inputStyle("m-email")}
                  onFocus={() => setFocusedField("m-email")}
                  onBlur={() => setFocusedField(null)}
                />
              </div>

              {/* Password */}
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, color: "rgba(255,255,255,0.5)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.5rem" }}>Password</label>
                <input
                  type="password"
                  placeholder="••••••••••"
                  value={platPass}
                  onChange={(e) => setPlatPass(e.target.value)}
                  style={inputStyle("m-pass")}
                  onFocus={() => setFocusedField("m-pass")}
                  onBlur={() => setFocusedField(null)}
                />
              </div>

              <button
                onClick={addNewPassword}
                style={{ background: "linear-gradient(135deg, #8b5cf6, #6366f1)", color: "#fff", border: "none", borderRadius: "14px", padding: "1rem", fontSize: "1rem", fontWeight: 600, cursor: "pointer", transition: "all 0.25s ease", boxShadow: "0 4px 20px rgba(139,92,246,0.4)", marginTop: "0.5rem", letterSpacing: "0.01em" }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 28px rgba(139,92,246,0.55)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(139,92,246,0.4)"; }}
              >
                Save Password →
              </button>
            </form>
          </div>
        </Modal>

        {/* ── Password Cards ── */}
        {passwords?.length !== 0 ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: "1.25rem",
              animation: "fadeUp 0.7s ease 0.2s both",
            }}
          >
            {passwords
              ?.filter((data) =>
                data.platform.toLowerCase().includes(searchTerm.toLowerCase())
              )
              .map((data, index) =>
                editingId === data._id ? (
                  // ── Edit card ──
                  <div
                    key={data._id}
                    style={{
                      background: "rgba(15,12,30,0.75)",
                      backdropFilter: "blur(20px)",
                      WebkitBackdropFilter: "blur(20px)",
                      borderRadius: "20px",
                      padding: "1.5rem",
                      border: "1px solid rgba(139,92,246,0.35)",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)",
                      animation: "cardIn 0.3s ease both",
                    }}
                  >
                    <p style={{ fontSize: "0.75rem", fontWeight: 500, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.8rem", margin: "0 0 0.8rem" }}>Editing — {data.platform}</p>
                    <div style={{ marginBottom: "1rem" }}>
                      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, color: "rgba(255,255,255,0.5)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.5rem" }}>New Password</label>
                      <input
                        type="password"
                        value={newPass}
                        onChange={(e) => setNewPass(e.target.value)}
                        placeholder="••••••••••"
                        style={inputStyle("edit-pass")}
                        onFocus={() => setFocusedField("edit-pass")}
                        onBlur={() => setFocusedField(null)}
                      />
                    </div>
                    <div style={{ display: "flex", gap: "0.6rem" }}>
                      <button
                        onClick={() => handleEditPassword(data._id, data.platform, data.platEmail)}
                        style={{ flex: 1, background: "linear-gradient(135deg, #10b981, #059669)", color: "#fff", border: "none", borderRadius: "10px", padding: "0.75rem", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", transition: "all 0.25s ease" }}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(16,185,129,0.4)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        style={{ flex: 1, background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "0.75rem", fontSize: "0.9rem", fontWeight: 600, cursor: "pointer", transition: "all 0.25s ease" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.15)"; e.currentTarget.style.color = "#f87171"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  // ── Display card ──
                  <div
                    key={data._id}
                    style={{
                      background: "rgba(15,12,30,0.7)",
                      backdropFilter: "blur(20px)",
                      WebkitBackdropFilter: "blur(20px)",
                      borderRadius: "20px",
                      padding: "1.5rem",
                      border: "1px solid rgba(255,255,255,0.07)",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)",
                      transition: "all 0.3s ease",
                      animation: `cardIn 0.4s ease ${index * 0.05}s both`,
                      position: "relative",
                      overflow: "hidden",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-4px)";
                      e.currentTarget.style.border = "1px solid rgba(139,92,246,0.3)";
                      e.currentTarget.style.boxShadow = "0 16px 48px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "none";
                      e.currentTarget.style.border = "1px solid rgba(255,255,255,0.07)";
                      e.currentTarget.style.boxShadow = "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)";
                    }}
                  >
                    {/* Decorative top bar */}
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: getGradient(data.platform), borderRadius: "20px 20px 0 0" }} />

                    {/* Card header */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: getGradient(data.platform), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem", fontWeight: 700, color: "#fff", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>
                          {platformInitial(data.platform)}
                        </div>
                        <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#fff", margin: 0, textTransform: "capitalize" }}>
                          {data.platform}
                        </h3>
                      </div>
                      <button
                        onClick={() => { setEditingId(data._id); setNewPass(data.password); }}
                        style={{ background: "rgba(139,92,246,0.15)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)", borderRadius: "8px", padding: "0.4rem 0.85rem", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", transition: "all 0.2s ease", letterSpacing: "0.02em" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(139,92,246,0.28)"; e.currentTarget.style.transform = "scale(1.04)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(139,92,246,0.15)"; e.currentTarget.style.transform = "none"; }}
                      >
                        Edit
                      </button>
                    </div>

                    {/* Email row */}
                    <div style={{ marginBottom: "0.85rem" }}>
                      <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 500, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.3rem" }}>Email</label>
                      <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "0.65rem 0.9rem" }}>
                        <span style={{ fontSize: "0.88rem", color: "rgba(255,255,255,0.65)", fontFamily: "monospace" }}>{data.platEmail}</span>
                      </div>
                    </div>

                    {/* Password row */}
                    <div>
                      <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 500, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.3rem" }}>Password</label>
                      <div style={{ background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.18)", borderRadius: "10px", padding: "0.65rem 0.9rem" }}>
                        <Password
                          key={data._id}
                          id={data._id}
                          name={data.platform}
                          password={data.password}
                          email={data.platEmail}
                          iv={data.iv}
                        />
                      </div>
                    </div>
                  </div>
                )
              )}
          </div>
        ) : (
          // ── Empty state ──
          <div style={{ textAlign: "center", maxWidth: "480px", margin: "4rem auto 0", animation: "fadeUp 0.7s ease both" }}>
            <div
              style={{
                background: "rgba(15,12,30,0.7)",
                backdropFilter: "blur(20px)",
                borderRadius: "24px",
                padding: "3.5rem 2rem",
                border: "1px solid rgba(255,255,255,0.07)",
                boxShadow: "0 20px 60px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)",
              }}
            >
              <div style={{ width: "72px", height: "72px", margin: "0 auto 1.5rem", background: "linear-gradient(135deg, rgba(139,92,246,0.3), rgba(99,102,241,0.3))", borderRadius: "20px", border: "1px solid rgba(139,92,246,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2rem" }}>🔐</div>
              <h3 style={{ fontFamily: "'Playfair Display', serif", fontSize: "1.5rem", color: "#fff", fontWeight: 700, margin: "0 0 0.6rem" }}>No passwords yet</h3>
              <p style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.4)", margin: "0 0 2rem", lineHeight: 1.65 }}>Add your first password and it will be encrypted and stored safely here.</p>
              <button
                onClick={() => setOpen(true)}
                style={{ background: "linear-gradient(135deg, #8b5cf6, #6366f1)", color: "#fff", border: "none", borderRadius: "14px", padding: "0.9rem 2rem", fontSize: "1rem", fontWeight: 600, cursor: "pointer", transition: "all 0.25s ease", boxShadow: "0 4px 20px rgba(139,92,246,0.4)" }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 28px rgba(139,92,246,0.55)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(139,92,246,0.4)"; }}
              >
                + Add Your First Password
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Passwords;
