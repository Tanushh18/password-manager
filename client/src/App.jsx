import React, { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./App.css";

import Home from "./Pages/Home/Home";
import Login from "./Pages/Login/Login";
import Signup from "./Pages/SignUp/Signup";
import Vault from "./Pages/Passwords/Passwords";
import Projects from "./Pages/Projects/Projects";
import ProjectDetail from "./Pages/Projects/ProjectDetail";
import ProjectForm from "./Pages/Projects/ProjectForm";
import Settings from "./Pages/Settings/Settings";
import Servers from "./Pages/Servers/Servers";
import Privacy from "./Pages/Privacy/Privacy";
import Logout from "./Pages/Logout/Logout";
import Navbar from "./Components/Navbar/Navbar";
import InstallPrompt from "./Components/InstallPrompt/InstallPrompt";
import Splash from "./Components/Splash/Splash";
import { useVault } from "./state/vault";

/* Routes that need an open vault. */
function RequireVault({ children }) {
  const { status } = useVault();
  const location = useLocation();
  if (status === "checking") return <Splash />;
  if (status === "signedOut") return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  return children;
}

/* The server list is for the owner's account only (the server enforces this too). */
function RequireAdmin({ children }) {
  const { profile } = useVault();
  return profile?.isAdmin ? children : <Navigate to="/passwords" replace />;
}

/* Sign-in pages bounce away once there's a session. */
function GuestOnly({ children }) {
  const { status } = useVault();
  if (status === "checking") return <Splash />;
  if (status === "ready") return <Navigate to="/passwords" replace />;
  return children;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

// Spotlight that follows the pointer across any hoverable card
function usePointerSpotlight() {
  useEffect(() => {
    const onMove = (e) => {
      const card = e.target.closest && e.target.closest(".card--hover");
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--px", `${e.clientX - rect.left}px`);
      card.style.setProperty("--py", `${e.clientY - rect.top}px`);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);
}

export default function App() {
  usePointerSpotlight();
  return (
    <div className="App">
      <BrowserRouter>
        <ScrollToTop />
        <Navbar />
        <ToastContainer position="top-right" autoClose={3500} newestOnTop closeOnClick pauseOnHover draggable theme="colored" />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/signin" element={<GuestOnly><Login /></GuestOnly>} />
          <Route path="/signup" element={<GuestOnly><Signup /></GuestOnly>} />
          <Route path="/passwords" element={<RequireVault><Vault /></RequireVault>} />
          <Route path="/projects" element={<RequireVault><Projects /></RequireVault>} />
          <Route path="/projects/new" element={<RequireVault><ProjectForm /></RequireVault>} />
          <Route path="/projects/:id" element={<RequireVault><ProjectDetail /></RequireVault>} />
          <Route path="/projects/:id/edit" element={<RequireVault><ProjectForm /></RequireVault>} />
          <Route path="/settings" element={<RequireVault><Settings /></RequireVault>} />
          <Route path="/servers" element={<RequireVault><RequireAdmin><Servers /></RequireAdmin></RequireVault>} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/logout" element={<Logout />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <InstallPrompt />
      </BrowserRouter>
    </div>
  );
}
