import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Foundation from "./Foundation";
import "./styles/tokens.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Foundation />
  </StrictMode>,
);
