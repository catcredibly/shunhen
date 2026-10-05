import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { db } from "./db";
import "./i18n";
import { StorageError } from "./components/StorageError";
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
    root.render(<StorageError error={error} />);
  });
