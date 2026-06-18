import type { FastifyInstance } from "fastify";
import type { LinkCreateInput, LinkUpdateInput } from "@supplier-schedule/shared";
import { prisma } from "../db.js";

export async function linkRoutes(app: FastifyInstance) {
  // GET /links?taskId=...
  app.get<{ Querystring: { taskId?: string } }>("/", async (req) => {
    const { taskId } = req.query;
    const data = await prisma.link.findMany({
      ...(taskId ? { where: { taskId } } : {}),
    });
    return { ok: true, data };
  });

  // POST /links
  app.post<{ Body: LinkCreateInput }>("/", async (req, reply) => {
    const { taskId, anchor, dependencyType, offsetDays, isLinked } = req.body;

    const link = await prisma.link.create({
      data: {
        taskId,
        anchorKind: anchor.kind,
        anchorEventId: anchor.kind === "event" ? anchor.eventId : null,
        anchorTaskId: anchor.kind === "task" ? anchor.taskId : null,
        dependencyType,
        offsetDays: offsetDays ?? 0,
        isLinked: isLinked ?? true,
      },
    });
    return reply.status(201).send({ ok: true, data: link });
  });

  // PATCH /links/:id
  app.patch<{ Params: { id: string }; Body: LinkUpdateInput }>(
    "/:id",
    async (req, reply) => {
      const link = await prisma.link.update({
        where: { id: req.params.id },
        data: req.body,
      });
      return { ok: true, data: link };
    }
  );

  // DELETE /links/:id
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    await prisma.link.delete({ where: { id: req.params.id } });
    return reply.status(204).send();
  });
}
