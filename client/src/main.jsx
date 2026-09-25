import React from "react";
import { createRoot } from "react-dom/client";
import "./styles/theme.css";
import "./index.css";
import App from "./App";
import { VaultProvider } from "./state/vault";
import { register as registerServiceWorker } from "./serviceWorkerRegistration";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <VaultProvider>
      <App />
    </VaultProvider>
  </React.StrictMode>
);

// Makes Aurelia installable on phones and usable offline.
registerServiceWorker();
