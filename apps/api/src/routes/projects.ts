import type { FastifyInstance } from "fastify";
import type {
  ProjectCreateInput,
  ProjectUpdateInput,
} from "@supplier-schedule/shared";
import { prisma } from "../db.js";

export async function projectRoutes(app: FastifyInstance) {
  // GET /projects
  app.get("/", async () => {
    return prisma.project.findMany({ orderBy: { createdAt: "desc" } });
  });

  // POST /projects
  app.post<{ Body: ProjectCreateInput }>("/", async (req, reply) => {
    const { name, description } = req.body;
    if (!name?.trim()) {
      return reply.status(400).send({ ok: false, error: "name is required" });
    }
    const project = await prisma.project.create({
      data: { name: name.trim(), description: description ?? null },
    });
    return reply.status(201).send({ ok: true, data: project });
  });

  // GET /projects/:id
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        oemEvents: { orderBy: { startDate: "asc" } },
        supplierTasks: { orderBy: { startDate: "asc" } },
      },
    });
    if (!project) return reply.status(404).send({ ok: false, error: "Not found" });
    return { ok: true, data: project };
  });

  // PATCH /projects/:id
  app.patch<{ Params: { id: string }; Body: ProjectUpdateInput }>(
    "/:id",
    async (req, reply) => {
      const { name, description } = req.body;
      const project = await prisma.project.update({
        where: { id: req.params.id },
        data: {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(description !== undefined ? { description } : {}),
        },
      });
      return { ok: true, data: project };
    }
  );

  // DELETE /projects/:id
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    await prisma.project.delete({ where: { id: req.params.id } });
    return reply.status(204).send();
  });
}
