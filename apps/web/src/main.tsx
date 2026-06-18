import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { GanttPage } from "./pages/GanttPage.js";
import { ImportPage } from "./pages/ImportPage.js";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id/gantt" element={<GanttPage />} />
        <Route path="/projects/:id/import" element={<ImportPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
