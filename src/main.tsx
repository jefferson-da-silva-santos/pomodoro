import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource/big-shoulders-display/700";
import "@fontsource/big-shoulders-display/900";
import "@fontsource-variable/outfit";
import "./styles.css";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Elemento #root não encontrado");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
