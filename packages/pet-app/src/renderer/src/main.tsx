import React from "react";
import { createRoot } from "react-dom/client";
import { PetApp } from "./PetApp";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

createRoot(root).render(
  <React.StrictMode>
    <PetApp />
  </React.StrictMode>,
);
