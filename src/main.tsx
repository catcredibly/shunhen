import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { db } from "./db";
import i18n from "./i18n";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);
// Verify the native SQLite connection before rendering either window.
void db
  .open()
  .then(() => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  })
  .catch((error) => {
    console.error("Study storage initialization failed.", error);
    root.render(
      <main className="page">
        <div className="empty-state" role="alert">
          <h2>{i18n.t("Unable to open study data")}</h2>
          <p>{i18n.t("Restart Shunhen to retry. Your study data has not been deleted.")}</p>
        </div>
      </main>,
    );
  });
