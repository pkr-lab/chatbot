import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { prefetchBootstrap } from "./api";
import { App } from "./App";
import { preloadMarkdown } from "./components/LazyMarkdown";
import "./styles.css";

prefetchBootstrap();

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

const idle = (window as unknown as { requestIdleCallback?: (callback: () => void) => number }).requestIdleCallback;
(idle ? idle.bind(window) : (callback: () => void) => window.setTimeout(callback, 400))(preloadMarkdown);
