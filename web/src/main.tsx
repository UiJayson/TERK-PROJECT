import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initSentry } from "./lib/sentry";
import "./styles/tokens.css";
import "./styles.css";
import "./styles/dashboard.css";
import "./styles/ux.css";
import "./styles/shell.css";

initSentry();

// Dev-only design preview: renders the app with fixture data, no database.
// Guarded by import.meta.env.DEV so the module is dropped from prod builds.
if (import.meta.env.DEV && localStorage.getItem("harbor:preview") === "1") {
  const { installMockApi } = await import("./dev/mockApi");
  installMockApi();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
