import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";

import { App } from "./App";
import { store } from "./app/store";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./styles/orbit.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const root = document.getElementById("root");
if (!root) {
  throw new Error("Orbit root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <Provider store={store}>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </Provider>
  </StrictMode>,
);
