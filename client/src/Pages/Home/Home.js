import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import "./Home.css";
import { useSelector } from "react-redux";

function Home() {
  const { name, isAuthenticated } = useSelector(state => state);
  const particlesRef = useRef(null);
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    // Inject keyframes + fonts once
    const id = "home-keyframes";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Playfair+Display:ital,wght@0,700;1,700&display=swap');
        @keyframes aurora1  { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(80px,-60px) scale(1.18)} }
        @keyframes aurora2  { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-70px,70px) scale(1.22)} }
        @keyframes aurora3  { 0%,100%{transform:translate(0,0) scale(1)} 60%{transform:translate(55px,35px) scale(1.12)} }
        @keyframes aurora4  { 0%,100%{transform:translate(0,0) scale(1)} 40%{transform:translate(-40px,-50px) scale(1.15)} }
        @keyframes float    { 0%,100%{transform:translateY(0) rotate(0deg);opacity:.65} 50%{transform:translateY(-22px) rotate(180deg);opacity:.2} }
        @keyframes fadeUp   { from{opacity:0;transform:translateY(28px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn   { from{opacity:0} to{opacity:1} }
        @keyframes shimmer  { 0%{background-position:200% center} 100%{background-position:-200% center} }
        @keyframes pulse    { 0%,100%{box-shadow:0 0 0 0 rgba(139,92,246,.4)} 70%{box-shadow:0 0 0 14px rgba(139,92,246,0)} }
        @keyframes orbit    { from{transform:rotate(0deg) translateX(120px) rotate(0deg)} to{transform:rotate(360deg) translateX(120px) rotate(-360deg)} }
        @keyframes orbit2   { from{transform:rotate(120deg) translateX(160px) rotate(-120deg)} to{transform:rotate(480deg) translateX(160px) rotate(-480deg)} }
        @keyframes orbit3   { from{transform:rotate(240deg) translateX(100px) rotate(-240deg)} to{transform:rotate(600deg) translateX(100px) rotate(-600deg)} }
        @keyframes spinRing { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes spinRingR{ from{transform:rotate(0deg)} to{transform:rotate(-360deg)} }
        @keyframes glowPulse{ 0%,100%{opacity:.5;transform:scale(1)} 50%{opacity:.9;transform:scale(1.08)} }
        @keyframes typeIn   { from{opacity:0;transform:translateX(-10px)} to{opacity:1;transform:translateX(0)} }
        @keyframes badgePop { 0%{transform:scale(.8);opacity:0} 70%{transform:scale(1.06)} 100%{transform:scale(1);opacity:1} }
        @keyframes cardFloat{ 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-8px)} }
        @keyframes lineGrow { from{width:0} to{width:100%} }
        @keyframes rotateSlow{ from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `;
      document.head.appendChild(style);
    }

    setTimeout(() => setMounted(true), 50);

    // Floating particles
    if (particlesRef.current && particlesRef.current.children.length === 0) {
      const colors = [
        "rgba(167,139,250,0.6)", "rgba(129,140,248,0.5)",
        "rgba(236,72,153,0.4)", "rgba(255,255,255,0.22)",
        "rgba(99,102,241,0.5)", "rgba(192,132,252,0.45)",
      ];
      for (let i = 0; i < 28; i++) {
        const p = document.createElement("div");
        const size = Math.random() * 5 + 1.5;
        p.style.cssText = `
          position:absolute;
          width:${size}px;height:${size}px;
          border-radius:50%;
          background:${colors[Math.floor(Math.random() * colors.length)]};
          left:${Math.random() * 100}%;top:${Math.random() * 100}%;
          animation:float ${7 + Math.random() * 9}s ease-in-out ${Math.random() * 7}s infinite;
          pointer-events:none;
        `;
        particlesRef.current.appendChild(p);
      }
    }

    // Interactive canvas — mouse-following web of connections
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;
    const dots = [];
    const DOT_COUNT = 55;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < DOT_COUNT; i++) {
      dots.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        r: Math.random() * 2 + 1,
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      // Mouse attraction
      dots.forEach((d) => {
        const dx = mx - d.x, dy = my - d.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 180) {
          d.vx += (dx / dist) * 0.018;
          d.vy += (dy / dist) * 0.018;
        }
        d.vx *= 0.985;
        d.vy *= 0.985;
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < 0 || d.x > canvas.width) d.vx *= -1;
        if (d.y < 0 || d.y > canvas.height) d.vy *= -1;
      });

      // Draw connections
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x;
          const dy = dots[i].y - dots[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 130) {
            ctx.beginPath();
            ctx.moveTo(dots[i].x, dots[i].y);
            ctx.lineTo(dots[j].x, dots[j].y);
            ctx.strokeStyle = `rgba(139,92,246,${(1 - dist / 130) * 0.18})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
        // Draw dot
        ctx.beginPath();
        ctx.arc(dots[i].x, dots[i].y, dots[i].r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(167,139,250,0.35)";
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const handleMouseMove = (e) => {
    mouseRef.current = { x: e.clientX, y: e.clientY };
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  const features = [
    { icon: "🛡️", label: "AES-256 Encrypted" },
    { icon: "⚡", label: "Instant Sync" },
    { icon: "🔑", label: "Zero Knowledge" },
  ];

  return (
    <div
      onMouseMove={handleMouseMove}
      style={{
        minHeight: "100vh",
        background: "#0d0b1a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'DM Sans', sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Interactive canvas */}
      <canvas
        ref={canvasRef}
        style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}
      />

      {/* Aurora blobs */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        <div style={{ position: "absolute", width: "680px", height: "680px", borderRadius: "50%", background: "radial-gradient(circle, rgba(109,40,217,0.42) 0%, transparent 70%)", top: "-180px", left: "-160px", filter: "blur(70px)", animation: "aurora1 11s ease-in-out infinite" }} />
        <div style={{ position: "absolute", width: "560px", height: "560px", borderRadius: "50%", background: "radial-gradient(circle, rgba(79,70,229,0.38) 0%, transparent 70%)", bottom: "-120px", right: "-120px", filter: "blur(75px)", animation: "aurora2 13s ease-in-out infinite" }} />
        <div style={{ position: "absolute", width: "420px", height: "420px", borderRadius: "50%", background: "radial-gradient(circle, rgba(236,72,153,0.28) 0%, transparent 70%)", top: "38%", left: "52%", filter: "blur(65px)", animation: "aurora3 15s ease-in-out infinite" }} />
        <div style={{ position: "absolute", width: "350px", height: "350px", borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.3) 0%, transparent 70%)", top: "20%", right: "15%", filter: "blur(60px)", animation: "aurora4 9s ease-in-out infinite" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,0.032) 1px, transparent 1px)", backgroundSize: "30px 30px" }} />
      </div>

      {/* Floating particles */}
      <div ref={particlesRef} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }} />

      {/* Mouse glow follower */}
      <div style={{
        position: "fixed",
        width: "320px", height: "320px",
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)",
        left: mousePos.x - 160,
        top: mousePos.y - 160,
        pointerEvents: "none",
        zIndex: 0,
        transition: "left 0.12s ease, top 0.12s ease",
        filter: "blur(10px)",
      }} />

      {/* Content */}
      <div style={{ position: "relative", zIndex: 1, textAlign: "center", padding: "2rem", maxWidth: "800px", width: "100%" }}>

        {!isAuthenticated ? (
          /* ── LOGGED OUT STATE ── */
          <div style={{ animation: mounted ? "fadeUp 0.8s ease both" : "none" }}>

            {/* Orbiting lock icon */}
            <div style={{ position: "relative", width: "160px", height: "160px", margin: "0 auto 2.5rem" }}>
              {/* Outer spinning ring */}
              <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px dashed rgba(139,92,246,0.3)", animation: "spinRing 18s linear infinite" }} />
              {/* Inner spinning ring */}
              <div style={{ position: "absolute", inset: "15px", borderRadius: "50%", border: "1px dashed rgba(236,72,153,0.25)", animation: "spinRingR 12s linear infinite" }} />

              {/* Orbiting dots */}
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ position: "absolute", width: "10px", height: "10px", borderRadius: "50%", background: "rgba(167,139,250,0.8)", animation: "orbit 5s linear infinite", boxShadow: "0 0 8px rgba(167,139,250,0.8)" }} />
                <div style={{ position: "absolute", width: "7px", height: "7px", borderRadius: "50%", background: "rgba(236,72,153,0.7)", animation: "orbit2 7s linear infinite", boxShadow: "0 0 6px rgba(236,72,153,0.7)" }} />
                <div style={{ position: "absolute", width: "6px", height: "6px", borderRadius: "50%", background: "rgba(129,140,248,0.7)", animation: "orbit3 4s linear infinite", boxShadow: "0 0 6px rgba(129,140,248,0.7)" }} />
              </div>

              {/* Center icon */}
              <div style={{ position: "absolute", inset: "28px", borderRadius: "50%", background: "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(99,102,241,0.25))", border: "1px solid rgba(139,92,246,0.4)", display: "flex", alignItems: "center", justifyContent: "center", animation: "glowPulse 3s ease-in-out infinite", backdropFilter: "blur(10px)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.9)" strokeWidth="1.8" style={{ width: "36px", height: "36px" }}>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <circle cx="12" cy="16" r="1" fill="rgba(167,139,250,0.9)" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
            </div>

            {/* Badge */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)", borderRadius: "50px", padding: "6px 16px", marginBottom: "1.5rem", animation: "badgePop 0.6s ease 0.3s both" }}>
              <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#a78bfa", boxShadow: "0 0 8px #a78bfa", display: "block", animation: "pulse 2s infinite", flexShrink: 0 }} />
              <span style={{ fontSize: "12px", color: "#c4b5fd", letterSpacing: "0.07em", fontWeight: 500 }}>MILITARY-GRADE SECURITY</span>
            </div>

            {/* Headline */}
            <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: "clamp(2.4rem, 6vw, 4rem)", color: "#fff", fontWeight: 700, lineHeight: 1.12, margin: "0 0 1.2rem", animation: "fadeUp 0.8s ease 0.15s both" }}>
              Welcome to{" "}
              <span style={{ background: "linear-gradient(135deg, #a78bfa, #818cf8, #e879f9, #a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", backgroundSize: "300% auto", animation: "shimmer 4s linear infinite", display: "inline-block" }}>
                SecureVault
              </span>
            </h1>

            {/* Subtitle */}
            <p style={{ fontSize: "clamp(1rem, 2.5vw, 1.15rem)", color: "rgba(255,255,255,0.45)", fontWeight: 300, lineHeight: 1.75, maxWidth: "520px", margin: "0 auto 2.5rem", animation: "fadeUp 0.8s ease 0.25s both" }}>
              Your trusted companion for secure password management. Store, organize, and access all your credentials — encrypted, always.
            </p>

            {/* Feature pills */}
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap", marginBottom: "2.8rem", animation: "fadeUp 0.8s ease 0.35s both" }}>
              {features.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "50px", padding: "0.5rem 1rem", animation: `badgePop 0.5s ease ${0.4 + i * 0.1}s both` }}>
                  <span style={{ fontSize: "0.9rem" }}>{f.icon}</span>
                  <span style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>{f.label}</span>
                </div>
              ))}
            </div>

            {/* CTA button */}
            <div style={{ animation: "fadeUp 0.8s ease 0.45s both" }}>
              <Link
                to="/signup"
                style={{ display: "inline-flex", alignItems: "center", gap: "0.6rem", background: "linear-gradient(135deg, #8b5cf6, #6366f1)", color: "#fff", textDecoration: "none", borderRadius: "16px", padding: "1rem 2.2rem", fontSize: "1.05rem", fontWeight: 600, letterSpacing: "0.01em", boxShadow: "0 4px 24px rgba(139,92,246,0.45)", transition: "all 0.25s ease", animation: "pulse 2.5s infinite" }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 10px 36px rgba(139,92,246,0.6)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 4px 24px rgba(139,92,246,0.45)"; }}
              >
                Get Started
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ width: "18px", height: "18px" }}>
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>

              <p style={{ marginTop: "1.2rem", fontSize: "0.82rem", color: "rgba(255,255,255,0.25)" }}>
                Already have an account?{" "}
                <Link to="/signin" style={{ color: "#a78bfa", textDecoration: "none", fontWeight: 500 }}>Sign in</Link>
              </p>
            </div>
          </div>

        ) : (
          /* ── LOGGED IN STATE ── */
          <div style={{ animation: mounted ? "fadeUp 0.8s ease both" : "none" }}>

            {/* Floating glass card */}
            <div style={{ background: "rgba(15,12,30,0.7)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", borderRadius: "28px", border: "1px solid rgba(139,92,246,0.2)", boxShadow: "0 30px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)", padding: "3rem 2.5rem", animation: "cardFloat 5s ease-in-out infinite", position: "relative", overflow: "hidden" }}>

              {/* Top gradient bar */}
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: "linear-gradient(90deg, #8b5cf6, #6366f1, #e879f9, #8b5cf6)", backgroundSize: "200% auto", animation: "shimmer 3s linear infinite" }} />

              {/* Avatar */}
              <div style={{ position: "relative", width: "90px", height: "90px", margin: "0 auto 1.8rem" }}>
                <div style={{ position: "absolute", inset: "-8px", borderRadius: "50%", border: "1.5px dashed rgba(139,92,246,0.35)", animation: "rotateSlow 12s linear infinite" }} />
                <div style={{ width: "90px", height: "90px", borderRadius: "50%", background: "linear-gradient(135deg, #8b5cf6, #6366f1, #e879f9)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.2rem", fontWeight: 700, color: "#fff", fontFamily: "'DM Sans', sans-serif", boxShadow: "0 0 30px rgba(139,92,246,0.5)", animation: "glowPulse 3s ease-in-out infinite" }}>
                  {name.charAt(0).toUpperCase()}
                </div>
              </div>

              {/* Badge */}
              <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)", borderRadius: "50px", padding: "5px 14px", marginBottom: "1.2rem" }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#34d399", boxShadow: "0 0 6px #34d399", display: "block", animation: "pulse 2s infinite", flexShrink: 0 }} />
                <span style={{ fontSize: "11px", color: "#6ee7b7", letterSpacing: "0.07em", fontWeight: 500 }}>VAULT UNLOCKED</span>
              </div>

              {/* Heading */}
              <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: "clamp(2rem, 5vw, 3rem)", color: "#fff", fontWeight: 700, lineHeight: 1.15, margin: "0 0 0.8rem" }}>
                Welcome back,{" "}
                <span style={{ background: "linear-gradient(135deg, #a78bfa, #818cf8, #e879f9, #a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", backgroundSize: "300% auto", animation: "shimmer 4s linear infinite", display: "inline-block" }}>
                  {name}
                </span>
              </h1>

              <p style={{ fontSize: "1rem", color: "rgba(255,255,255,0.42)", fontWeight: 300, lineHeight: 1.7, margin: "0 0 2.2rem" }}>
                Your vault is secure and ready. Manage all your passwords in one place.
              </p>

              {/* Stats row */}
              <div style={{ display: "flex", gap: "1rem", justifyContent: "center", marginBottom: "2.2rem", flexWrap: "wrap" }}>
                {[
                  { icon: "🛡️", label: "Encrypted", color: "rgba(139,92,246,0.2)", border: "rgba(139,92,246,0.3)" },
                  { icon: "⚡", label: "Synced", color: "rgba(99,102,241,0.2)", border: "rgba(99,102,241,0.3)" },
                  { icon: "✅", label: "Secured", color: "rgba(52,211,153,0.15)", border: "rgba(52,211,153,0.3)" },
                ].map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: s.color, border: `1px solid ${s.border}`, borderRadius: "12px", padding: "0.6rem 1.1rem" }}>
                    <span style={{ fontSize: "1rem" }}>{s.icon}</span>
                    <span style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.6)", fontWeight: 500 }}>{s.label}</span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <Link
                to="/passwords"
                style={{ display: "inline-flex", alignItems: "center", gap: "0.6rem", background: "linear-gradient(135deg, #8b5cf6, #6366f1)", color: "#fff", textDecoration: "none", borderRadius: "16px", padding: "1rem 2.2rem", fontSize: "1.05rem", fontWeight: 600, letterSpacing: "0.01em", boxShadow: "0 4px 24px rgba(139,92,246,0.45)", transition: "all 0.25s ease" }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 10px 36px rgba(139,92,246,0.6)"; e.currentTarget.style.background = "linear-gradient(135deg, #7c3aed, #4f46e5)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 4px 24px rgba(139,92,246,0.45)"; e.currentTarget.style.background = "linear-gradient(135deg, #8b5cf6, #6366f1)"; }}
              >
                Open Vault
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ width: "18px", height: "18px" }}>
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Home;
