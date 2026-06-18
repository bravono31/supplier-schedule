/**
 * Recalculation engine.
 *
 * When an OEM event date changes, this module:
 *   1. Finds all Links that anchor to that event (or transitively to tasks anchored to it).
 *   2. Computes new start/end dates respecting dependency type + offsetDays.
 *   3. Returns a preview (diff) without touching the DB.
 *   4. Separates linked (auto-update) vs non-linked (drift-warning) tasks.
 *
 * The caller must persist the changes after the user confirms the preview.
 */

import type { DependencyType } from "@supplier-schedule/shared";

// ── Date helpers ───────────────────────────────────────────────────────────

/** Add days to a Date, returning a new Date. */
export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/** Difference in whole days (a - b). */
export function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

// ── Anchor date resolution ─────────────────────────────────────────────────

/**
 * Given the anchor's start/end dates and the dependency type,
 * returns the "reference date" from which offsetDays is applied.
 *
 *   FS  → anchor.endDate   (task starts after anchor finishes)
 *   SS  → anchor.startDate (task starts when anchor starts)
 *   EE  → anchor.endDate   (task ends when anchor ends)
 *   SE  → anchor.startDate (task ends when anchor starts — rare)
 */
export function anchorReferenceDate(
  anchorStart: Date,
  anchorEnd: Date,
  depType: DependencyType
): Date {
  switch (depType) {
    case "FS":
      return anchorEnd;
    case "SS":
      return anchorStart;
    case "EE":
      return anchorEnd;
    case "SE":
      return anchorStart;
  }
}

/**
 * Given the reference date, dependency type, offsetDays, and task duration,
 * compute new start and end dates for the dependent task.
 *
 * For FS/SS: reference → new start.  end = start + duration.
 * For EE/SE: reference → new end.    start = end - duration.
 */
export function computeNewDates(
  refDate: Date,
  depType: DependencyType,
  offsetDays: number,
  durationDays: number // original task duration (endDate - startDate in days)
): { start: Date; end: Date } {
  const adjusted = addDays(refDate, offsetDays);

  if (depType === "EE" || depType === "SE") {
    // reference fixes the end
    const end = adjusted;
    const start = addDays(end, -durationDays);
    return { start, end };
  } else {
    // FS / SS — reference fixes the start
    const start = adjusted;
    const end = addDays(start, durationDays);
    return { start, end };
  }
}

// ── Domain model used by the engine (detached from Prisma types) ───────────

export interface TaskNode {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  durationDays: number; // pre-computed
}

export interface LinkNode {
  id: string;
  taskId: string;
  anchorKind: "event" | "task";
  anchorEventId: string | null;
  anchorTaskId: string | null;
  dependencyType: DependencyType;
  offsetDays: number;
  isLinked: boolean;
}

export interface EventNode {
  id: string;
  startDate: Date;
  endDate: Date;
}

// ── Result types ───────────────────────────────────────────────────────────

export interface TaskDateDelta {
  taskId: string;
  taskName: string;
  oldStartDate: Date;
  newStartDate: Date;
  oldEndDate: Date;
  newEndDate: Date;
  deltaDays: number;
}

export interface RecalcResult {
  changedTasks: TaskDateDelta[];
  driftWarningTaskIds: string[];
  /** Circular dependency detected — no changes were computed. */
  cycleDetected: boolean;
}

// ── Main recalculation function ────────────────────────────────────────────

/**
 * Compute the effect of changing one or more OEM event dates.
 *
 * @param updatedEvents  Map of eventId → new {startDate, endDate}
 * @param allEvents      All events in the project (keyed by id)
 * @param allTasks       All supplier tasks in the project (keyed by id)
 * @param allLinks       All links in the project
 * @returns              Preview — does NOT persist anything.
 */
export function recalculate(
  updatedEvents: Map<string, { startDate: Date; endDate: Date }>,
  allEvents: Map<string, EventNode>,
  allTasks: Map<string, TaskNode>,
  allLinks: LinkNode[]
): RecalcResult {
  // Merge updated event dates into a working copy of events
  const events = new Map<string, EventNode>(
    [...allEvents].map(([id, ev]) => [
      id,
      updatedEvents.has(id) ? { ...ev, ...updatedEvents.get(id)! } : ev,
    ])
  );

  // Topological sort of tasks (via task→task links)
  const taskOrder = topologicalSort(allTasks, allLinks);
  if (taskOrder === null) {
    return { changedTasks: [], driftWarningTaskIds: [], cycleDetected: true };
  }

  // Working copy of task dates (mutable)
  const taskDates = new Map<string, { startDate: Date; endDate: Date }>(
    [...allTasks].map(([id, t]) => [
      id,
      { startDate: t.startDate, endDate: t.endDate },
    ])
  );

  const changedTasks: TaskDateDelta[] = [];
  const driftWarningTaskIds: string[] = [];

  // Process tasks in topological order so that task→task chains propagate correctly
  for (const taskId of taskOrder) {
    const task = allTasks.get(taskId);
    if (!task) continue;

    // Find all links for this task
    const links = allLinks.filter((l) => l.taskId === taskId);

    for (const link of links) {
      // Resolve anchor dates
      let anchorStart: Date;
      let anchorEnd: Date;

      if (link.anchorKind === "event" && link.anchorEventId) {
        const ev = events.get(link.anchorEventId);
        if (!ev) continue;
        anchorStart = ev.startDate;
        anchorEnd = ev.endDate;
      } else if (link.anchorKind === "task" && link.anchorTaskId) {
        const anchorDates = taskDates.get(link.anchorTaskId);
        if (!anchorDates) continue;
        anchorStart = anchorDates.startDate;
        anchorEnd = anchorDates.endDate;
      } else {
        continue;
      }

      // Did the anchor actually change?
      const anchorChanged =
        link.anchorKind === "event" && updatedEvents.has(link.anchorEventId!);

      const anchorTaskChanged =
        link.anchorKind === "task" &&
        link.anchorTaskId !== null &&
        changedTasks.some((c) => c.taskId === link.anchorTaskId);

      if (!anchorChanged && !anchorTaskChanged) continue;

      if (!link.isLinked) {
        // Non-linked: flag drift warning, do not update dates
        if (!driftWarningTaskIds.includes(taskId)) {
          driftWarningTaskIds.push(taskId);
        }
        continue;
      }

      // Compute new dates
      const refDate = anchorReferenceDate(
        anchorStart,
        anchorEnd,
        link.dependencyType
      );
      const duration = task.durationDays;
      const { start: newStart, end: newEnd } = computeNewDates(
        refDate,
        link.dependencyType,
        link.offsetDays,
        duration
      );

      const current = taskDates.get(taskId)!;
      if (
        newStart.getTime() === current.startDate.getTime() &&
        newEnd.getTime() === current.endDate.getTime()
      ) {
        continue;
      }

      const oldStart = current.startDate;
      const oldEnd = current.endDate;

      // Update working copy
      taskDates.set(taskId, { startDate: newStart, endDate: newEnd });

      changedTasks.push({
        taskId,
        taskName: task.name,
        oldStartDate: oldStart,
        newStartDate: newStart,
        oldEndDate: oldEnd,
        newEndDate: newEnd,
        deltaDays: diffDays(newStart, oldStart),
      });
    }
  }

  return { changedTasks, driftWarningTaskIds, cycleDetected: false };
}

// ── Topological sort (Kahn's algorithm) ───────────────────────────────────

/**
 * Returns task IDs in a valid processing order (dependencies before dependents).
 * Returns null if a cycle is detected.
 */
function topologicalSort(
  tasks: Map<string, TaskNode>,
  links: LinkNode[]
): string[] | null {
  const taskIds = [...tasks.keys()];
  const inDegree = new Map<string, number>(taskIds.map((id) => [id, 0]));
  const adjacency = new Map<string, string[]>(taskIds.map((id) => [id, []]));

  for (const link of links) {
    if (link.anchorKind !== "task" || !link.anchorTaskId) continue;
    // anchorTask → task (anchor must be processed first)
    const src = link.anchorTaskId;
    const dst = link.taskId;
    if (!tasks.has(src) || !tasks.has(dst)) continue;
    adjacency.get(src)!.push(dst);
    inDegree.set(dst, (inDegree.get(dst) ?? 0) + 1);
  }

  const queue = taskIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
  const order: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      const deg = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0) queue.push(neighbor);
    }
  }

  return order.length === taskIds.length ? order : null; // null = cycle
}
