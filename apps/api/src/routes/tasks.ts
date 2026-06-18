import type { FastifyInstance } from "fastify";
import type {
  SupplierTaskCreateInput,
  SupplierTaskUpdateInput,
} from "@supplier-schedule/shared";
import { prisma } from "../db.js";

export async function taskRoutes(app: FastifyInstance) {
  // GET /tasks?projectId=...
  app.get<{ Querystring: { projectId?: string } }>("/", async (req) => {
    const { projectId } = req.query;
    const data = await prisma.supplierTask.findMany({
      ...(projectId ? { where: { projectId } } : {}),
      include: { incomingLinks: true },
      orderBy: { startDate: "asc" },
    });
    return { ok: true, data };
  });

  // POST /tasks
  app.post<{ Body: SupplierTaskCreateInput }>("/", async (req, reply) => {
    const { projectId, name, category, startDate, endDate, status } = req.body;
    const task = await prisma.supplierTask.create({
      data: {
        projectId,
        name,
        category,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        status: status ?? "not_started",
      },
    });
    return reply.status(201).send({ ok: true, data: task });
  });

  // GET /tasks/:id
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const task = await prisma.supplierTask.findUnique({
      where: { id: req.params.id },
      include: { incomingLinks: true },
    });
    if (!task) return reply.status(404).send({ ok: false, error: "Not found" });
    return { ok: true, data: task };
  });

  // PATCH /tasks/:id
  app.patch<{
    Params: { id: string };
    Body: SupplierTaskUpdateInput & { driftWarning?: boolean };
  }>("/:id", async (req, reply) => {
    const { startDate, endDate, ...rest } = req.body;
    const task = await prisma.supplierTask.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        ...(startDate ? { startDate: new Date(startDate) } : {}),
        ...(endDate ? { endDate: new Date(endDate) } : {}),
      },
    });
    return { ok: true, data: task };
  });

  // DELETE /tasks/:id
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    await prisma.supplierTask.delete({ where: { id: req.params.id } });
    return reply.status(204).send();
  });
}
