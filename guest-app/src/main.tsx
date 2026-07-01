import React from "react";
import ReactDOM from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { BrowserRouter } from "react-router-dom";
import { GuestAuthProvider } from "./context/GuestAuthContext";
import { App } from "./App";
// Side-effect import: injects a <link rel="preload"> for the current
// page's static hero fallback at module evaluation time, before React
// renders anything. This lets the browser start the hero image download
// in parallel with the Firestore fetch that resolves the real URL.
import "./utils/heroPrefetch";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <GuestAuthProvider>
          <App />
        </GuestAuthProvider>
      </BrowserRouter>
    </HelmetProvider>
  </React.StrictMode>
);
