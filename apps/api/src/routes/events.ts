import type { FastifyInstance } from "fastify";
import type {
  OemEventCreateInput,
  OemEventUpdateInput,
} from "@supplier-schedule/shared";
import { prisma } from "../db.js";
import {
  recalculate,
  type EventNode,
  type TaskNode,
  type LinkNode,
} from "../recalc/engine.js";

export async function eventRoutes(app: FastifyInstance) {
  // GET /events?projectId=...
  app.get<{ Querystring: { projectId?: string } }>("/", async (req) => {
    const { projectId } = req.query;
    return prisma.oemEvent.findMany({
      ...(projectId ? { where: { projectId } } : {}),
      orderBy: { startDate: "asc" },
    });
  });

  // POST /events
  app.post<{ Body: OemEventCreateInput }>("/", async (req, reply) => {
    const { projectId, name, type, startDate, endDate, isMilestone } = req.body;
    const event = await prisma.oemEvent.create({
      data: {
        projectId,
        name,
        type,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        isMilestone: isMilestone ?? false,
      },
    });
    return reply.status(201).send({ ok: true, data: event });
  });

  // GET /events/:id
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const event = await prisma.oemEvent.findUnique({
      where: { id: req.params.id },
    });
    if (!event) return reply.status(404).send({ ok: false, error: "Not found" });
    return { ok: true, data: event };
  });

  // PATCH /events/:id — returns recalc preview, does NOT persist
  app.patch<{
    Params: { id: string };
    Body: OemEventUpdateInput & { preview?: boolean };
  }>("/:id", async (req, reply) => {
    const eventId = req.params.id;
    const { startDate, endDate, preview = false, ...rest } = req.body;

    if (preview && (startDate || endDate)) {
      // Return recalc preview without persisting
      const existingEvent = await prisma.oemEvent.findUnique({
        where: { id: eventId },
      });
      if (!existingEvent)
        return reply.status(404).send({ ok: false, error: "Not found" });

      const allEvents = await prisma.oemEvent.findMany({
        where: { projectId: existingEvent.projectId },
      });
      const allTasks = await prisma.supplierTask.findMany({
        where: { projectId: existingEvent.projectId },
      });
      const allLinks = await prisma.link.findMany({
        where: {
          task: { projectId: existingEvent.projectId },
        },
      });

      const eventsMap = new Map<string, EventNode>(
        allEvents.map((ev) => [
          ev.id,
          { id: ev.id, startDate: ev.startDate, endDate: ev.endDate },
        ])
      );
      const tasksMap = new Map<string, TaskNode>(
        allTasks.map((t) => {
          const dur = Math.round(
            (t.endDate.getTime() - t.startDate.getTime()) / 86_400_000
          );
          return [
            t.id,
            {
              id: t.id,
              name: t.name,
              startDate: t.startDate,
              endDate: t.endDate,
              durationDays: dur,
            },
          ];
        })
      );
      const linksArr: LinkNode[] = allLinks.map((l) => ({
        id: l.id,
        taskId: l.taskId,
        anchorKind: l.anchorKind === "event" ? "event" : "task",
        anchorEventId: l.anchorEventId,
        anchorTaskId: l.anchorTaskId,
        dependencyType: l.dependencyType as LinkNode["dependencyType"],
        offsetDays: l.offsetDays,
        isLinked: l.isLinked,
      }));

      const updatedEvents = new Map([
        [
          eventId,
          {
            startDate: startDate
              ? new Date(startDate)
              : existingEvent.startDate,
            endDate: endDate ? new Date(endDate) : existingEvent.endDate,
          },
        ],
      ]);

      const result = recalculate(updatedEvents, eventsMap, tasksMap, linksArr);
      return { ok: true, data: result };
    }

    // Actual persist update
    const updateData: Record<string, unknown> = { ...rest };
    if (startDate) updateData["startDate"] = new Date(startDate);
    if (endDate) updateData["endDate"] = new Date(endDate);

    const updated = await prisma.oemEvent.update({
      where: { id: eventId },
      data: updateData,
    });
    return { ok: true, data: updated };
  });

  // POST /events/:id/apply-recalc — persist recalc after user confirms preview
  app.post<{
    Params: { id: string };
    Body: { startDate?: string; endDate?: string };
  }>("/:id/apply-recalc", async (req, reply) => {
    const eventId = req.params.id;
    const { startDate, endDate } = req.body;

    const existingEvent = await prisma.oemEvent.findUnique({
      where: { id: eventId },
    });
    if (!existingEvent)
      return reply.status(404).send({ ok: false, error: "Not found" });

    const allEvents = await prisma.oemEvent.findMany({
      where: { projectId: existingEvent.projectId },
    });
    const allTasks = await prisma.supplierTask.findMany({
      where: { projectId: existingEvent.projectId },
    });
    const allLinks = await prisma.link.findMany({
      where: { task: { projectId: existingEvent.projectId } },
    });

    const eventsMap = new Map<string, EventNode>(
      allEvents.map((ev) => [
        ev.id,
        { id: ev.id, startDate: ev.startDate, endDate: ev.endDate },
      ])
    );
    const tasksMap = new Map<string, TaskNode>(
      allTasks.map((t) => {
        const dur = Math.round(
          (t.endDate.getTime() - t.startDate.getTime()) / 86_400_000
        );
        return [
          t.id,
          {
            id: t.id,
            name: t.name,
            startDate: t.startDate,
            endDate: t.endDate,
            durationDays: dur,
          },
        ];
      })
    );
    const linksArr: LinkNode[] = allLinks.map((l) => ({
      id: l.id,
      taskId: l.taskId,
      anchorKind: l.anchorKind === "event" ? "event" : "task",
      anchorEventId: l.anchorEventId,
      anchorTaskId: l.anchorTaskId,
      dependencyType: l.dependencyType as LinkNode["dependencyType"],
      offsetDays: l.offsetDays,
      isLinked: l.isLinked,
    }));

    const newEventDates = {
      startDate: startDate ? new Date(startDate) : existingEvent.startDate,
      endDate: endDate ? new Date(endDate) : existingEvent.endDate,
    };
    const updatedEventsInput = new Map([[eventId, newEventDates]]);
    const result = recalculate(
      updatedEventsInput,
      eventsMap,
      tasksMap,
      linksArr
    );

    if (result.cycleDetected) {
      return reply
        .status(422)
        .send({ ok: false, error: "Circular dependency detected" });
    }

    // Persist everything in a transaction
    await prisma.$transaction(async (tx) => {
      // Update the event itself
      await tx.oemEvent.update({
        where: { id: eventId },
        data: newEventDates,
      });

      // Update linked tasks
      for (const delta of result.changedTasks) {
        await tx.supplierTask.update({
          where: { id: delta.taskId },
          data: {
            startDate: delta.newStartDate,
            endDate: delta.newEndDate,
            driftWarning: false,
          },
        });
      }

      // Set drift warning for non-linked tasks
      for (const taskId of result.driftWarningTaskIds) {
        await tx.supplierTask.update({
          where: { id: taskId },
          data: { driftWarning: true },
        });
      }
    });

    return {
      ok: true,
      data: {
        updatedEventId: eventId,
        changedTaskCount: result.changedTasks.length,
        driftWarningCount: result.driftWarningTaskIds.length,
      },
    };
  });

  // DELETE /events/:id
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    await prisma.oemEvent.delete({ where: { id: req.params.id } });
    return reply.status(204).send();
  });
}
