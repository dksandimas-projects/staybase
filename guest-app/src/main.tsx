import React from "react";
import ReactDOM from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { BrowserRouter } from "react-router-dom";
import { GuestAuthProvider } from "./context/GuestAuthContext";
import { App } from "./App";
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
