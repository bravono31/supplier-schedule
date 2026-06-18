import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { projectRoutes } from "./routes/projects.js";
import { eventRoutes } from "./routes/events.js";
import { taskRoutes } from "./routes/tasks.js";
import { linkRoutes } from "./routes/links.js";
import { importRoutes } from "./routes/imports.js";

const PORT = Number(process.env["PORT"] ?? 3001);
const HOST = process.env["HOST"] ?? "0.0.0.0";

async function build() {
  const app = Fastify({
    logger: {
      level: process.env["LOG_LEVEL"] ?? "info",
    },
  });

  // ── Plugins ──────────────────────────────────────────
  await app.register(cors, {
    origin: process.env["CORS_ORIGIN"] ?? "http://localhost:5173",
    methods: ["GET", "POST", "PATCH", "DELETE"],
    credentials: true,
  });

  await app.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024, // 20 MB max image size
    },
  });

  // ── Routes ───────────────────────────────────────────
  await app.register(projectRoutes, { prefix: "/projects" });
  await app.register(eventRoutes, { prefix: "/events" });
  await app.register(taskRoutes, { prefix: "/tasks" });
  await app.register(linkRoutes, { prefix: "/links" });
  await app.register(importRoutes, { prefix: "/imports" });

  // ── Health check ─────────────────────────────────────
  app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  return app;
}

async function start() {
  const app = await build();
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`API server listening on http://${HOST}:${PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
