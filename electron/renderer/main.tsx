import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { RendererApp } from "./RendererApp.js";

const rootElement = document.querySelector<HTMLElement>("#root");

if (!rootElement) {
  throw new Error("React renderer root is missing from electron/renderer/index.html.");
}

const root = createRoot(rootElement);

flushSync(() => {
  root.render(<RendererApp />);
});
