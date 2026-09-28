import React from "react";
import { createRoot } from "react-dom/client";
import "./styles/theme.css";
import "./index.css";
import App from "./App";
import { VaultProvider } from "./state/vault";
import ErrorBoundary from "./Components/ErrorBoundary/ErrorBoundary";
import { register as registerServiceWorker } from "./serviceWorkerRegistration";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <VaultProvider>
        <App />
      </VaultProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

// Makes Stashr installable on phones and usable offline.
registerServiceWorker();
