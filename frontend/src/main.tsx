import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";

import { store } from "./app/store";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./styles/orbit.css";
import "./styles/mobile.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const root = document.getElementById("root");
if (!root) {
  throw new Error("Orbit root element was not found");
}

const mobilityOnly = import.meta.env.VITE_MOBILITY_ONLY === "1";
if (mobilityOnly && !window.location.pathname.startsWith("/mobility")) {
  window.history.replaceState(null, "", "/mobility");
}

const app = mobilityOnly || window.location.pathname.startsWith("/mobility")
  ? import("./mobile/MobilityApp").then(({ MobilityApp }) => <MobilityApp />)
  : import("./App").then(({ App }) => (
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    ));

void app.then((view) => {
  createRoot(root).render(
    <StrictMode>
      <Provider store={store}>{view}</Provider>
    </StrictMode>,
  );
});
