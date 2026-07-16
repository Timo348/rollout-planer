import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/barlow/latin-ext-400.css";
import "@fontsource/barlow/latin-ext-500.css";
import "@fontsource/barlow/latin-ext-600.css";
import "@fontsource/barlow/latin-ext-700.css";
import "@fontsource/barlow/latin-ext-800.css";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
