import { describe, it, expect } from "vitest";
import {
  addDays,
  diffDays,
  anchorReferenceDate,
  computeNewDates,
  recalculate,
  type TaskNode,
  type LinkNode,
  type EventNode,
} from "./engine.js";

// ── Helpers ────────────────────────────────────────────

const d = (s: string) => new Date(s + "T00:00:00Z");

function makeEvent(id: string, start: string, end: string): EventNode {
  return { id, startDate: d(start), endDate: d(end) };
}

function makeTask(
  id: string,
  start: string,
  end: string,
  name?: string
): TaskNode {
  const s = d(start);
  const e = d(end);
  return {
    id,
    name: name ?? id,
    startDate: s,
    endDate: e,
    durationDays: diffDays(e, s),
  };
}

function makeLink(
  taskId: string,
  anchorKind: "event" | "task",
  anchorId: string,
  opts?: Partial<Omit<LinkNode, "taskId" | "anchorKind" | "anchorEventId" | "anchorTaskId">>
): LinkNode {
  return {
    id: `link-${taskId}`,
    taskId,
    anchorKind,
    anchorEventId: anchorKind === "event" ? anchorId : null,
    anchorTaskId: anchorKind === "task" ? anchorId : null,
    dependencyType: opts?.dependencyType ?? "FS",
    offsetDays: opts?.offsetDays ?? 0,
    isLinked: opts?.isLinked ?? true,
  };
}

// ── Tests ──────────────────────────────────────────────

describe("addDays / diffDays", () => {
  it("adds positive days", () => {
    expect(addDays(d("2025-01-01"), 10)).toEqual(d("2025-01-11"));
  });
  it("adds negative days", () => {
    expect(addDays(d("2025-01-10"), -10)).toEqual(d("2024-12-31"));
  });
  it("diffDays returns signed difference", () => {
    expect(diffDays(d("2025-01-11"), d("2025-01-01"))).toBe(10);
    expect(diffDays(d("2025-01-01"), d("2025-01-11"))).toBe(-10);
  });
});

describe("anchorReferenceDate", () => {
  const start = d("2025-03-01");
  const end = d("2025-03-15");
  it("FS uses anchor end", () => expect(anchorReferenceDate(start, end, "FS")).toEqual(end));
  it("SS uses anchor start", () => expect(anchorReferenceDate(start, end, "SS")).toEqual(start));
  it("EE uses anchor end", () => expect(anchorReferenceDate(start, end, "EE")).toEqual(end));
  it("SE uses anchor start", () => expect(anchorReferenceDate(start, end, "SE")).toEqual(start));
});

describe("computeNewDates", () => {
  it("FS offset=0 duration=7 → start on ref, end 7 days later", () => {
    const ref = d("2025-04-01");
    const { start, end } = computeNewDates(ref, "FS", 0, 7);
    expect(start).toEqual(d("2025-04-01"));
    expect(end).toEqual(d("2025-04-08"));
  });

  it("FS offset=-30 duration=7 → start 30 days before ref", () => {
    const ref = d("2025-04-30");
    const { start, end } = computeNewDates(ref, "FS", -30, 7);
    expect(start).toEqual(d("2025-03-31"));
    expect(end).toEqual(d("2025-04-07"));
  });

  it("EE offset=0 duration=5 → end on ref, start 5 days before", () => {
    const ref = d("2025-05-10");
    const { start, end } = computeNewDates(ref, "EE", 0, 5);
    expect(end).toEqual(d("2025-05-10"));
    expect(start).toEqual(d("2025-05-05"));
  });
});

// ── recalculate integration tests ─────────────────────

describe("recalculate — basic event shift", () => {
  it("shifts a linked FS task when its anchor event moves +10 days", () => {
    const ev = makeEvent("ev1", "2025-06-01", "2025-06-15");
    // Task starts the day after event ends (FS, offset=+1), duration=5 days
    // offset=+1: start = anchorEnd(Jun 15) + 1 = Jun 16
    const task = makeTask("t1", "2025-06-16", "2025-06-21", "Proto build");
    const link = makeLink("t1", "event", "ev1", { dependencyType: "FS", offsetDays: 1 });

    const updatedEvents = new Map([
      ["ev1", { startDate: d("2025-06-11"), endDate: d("2025-06-25") }],
    ]);

    const result = recalculate(
      updatedEvents,
      new Map([["ev1", ev]]),
      new Map([["t1", task]]),
      [link]
    );

    expect(result.cycleDetected).toBe(false);
    expect(result.changedTasks).toHaveLength(1);
    const delta = result.changedTasks[0]!;
    expect(delta.taskId).toBe("t1");
    expect(delta.deltaDays).toBe(10);
    expect(delta.newStartDate).toEqual(d("2025-06-26"));
    expect(delta.newEndDate).toEqual(d("2025-07-01"));
  });

  it("does not move a non-linked task but raises drift warning", () => {
    const ev = makeEvent("ev1", "2025-06-01", "2025-06-15");
    const task = makeTask("t1", "2025-06-16", "2025-06-21");
    const link = makeLink("t1", "event", "ev1", { isLinked: false });

    const result = recalculate(
      new Map([["ev1", { startDate: d("2025-06-11"), endDate: d("2025-06-25") }]]),
      new Map([["ev1", ev]]),
      new Map([["t1", task]]),
      [link]
    );

    expect(result.changedTasks).toHaveLength(0);
    expect(result.driftWarningTaskIds).toContain("t1");
  });

  it("does not change tasks when anchor event date is unchanged", () => {
    const ev = makeEvent("ev1", "2025-06-01", "2025-06-15");
    const task = makeTask("t1", "2025-06-16", "2025-06-21");
    const link = makeLink("t1", "event", "ev1");

    // updatedEvents is empty — nothing changed
    const result = recalculate(
      new Map(),
      new Map([["ev1", ev]]),
      new Map([["t1", task]]),
      [link]
    );

    expect(result.changedTasks).toHaveLength(0);
    expect(result.driftWarningTaskIds).toHaveLength(0);
  });
});

describe("recalculate — task-to-task chain propagation", () => {
  it("propagates a shift through a FS task chain (ev→t1→t2)", () => {
    const ev = makeEvent("ev1", "2025-06-01", "2025-06-10");
    // t1: FS anchor=ev, offset=+1, duration=5
    //   start = anchorEnd(Jun 10) + 1 = Jun 11, end = Jun 16
    const t1 = makeTask("t1", "2025-06-11", "2025-06-16");
    // t2: FS anchor=t1, offset=+1, duration=3
    //   start = t1.end(Jun 16) + 1 = Jun 17, end = Jun 20
    const t2 = makeTask("t2", "2025-06-17", "2025-06-20");

    const links: LinkNode[] = [
      makeLink("t1", "event", "ev1", { dependencyType: "FS", offsetDays: 1 }),
      makeLink("t2", "task", "t1", { dependencyType: "FS", offsetDays: 1 }),
    ];

    // Shift event +5 days
    const result = recalculate(
      new Map([["ev1", { startDate: d("2025-06-06"), endDate: d("2025-06-15") }]]),
      new Map([["ev1", ev]]),
      new Map([["t1", t1], ["t2", t2]]),
      links
    );

    expect(result.cycleDetected).toBe(false);
    expect(result.changedTasks).toHaveLength(2);
    const d1 = result.changedTasks.find((c) => c.taskId === "t1")!;
    const d2 = result.changedTasks.find((c) => c.taskId === "t2")!;
    expect(d1.deltaDays).toBe(5);
    expect(d2.deltaDays).toBe(5);
  });
});

describe("recalculate — cycle detection", () => {
  it("returns cycleDetected=true when tasks form a cycle", () => {
    const ev = makeEvent("ev1", "2025-01-01", "2025-01-10");
    const t1 = makeTask("t1", "2025-01-11", "2025-01-15");
    const t2 = makeTask("t2", "2025-01-16", "2025-01-20");

    // t1 depends on t2, t2 depends on t1 — cycle
    const links: LinkNode[] = [
      makeLink("t1", "task", "t2"),
      makeLink("t2", "task", "t1"),
    ];

    const result = recalculate(
      new Map([["ev1", { startDate: d("2025-01-06"), endDate: d("2025-01-15") }]]),
      new Map([["ev1", ev]]),
      new Map([["t1", t1], ["t2", t2]]),
      links
    );

    expect(result.cycleDetected).toBe(true);
  });
});

describe("recalculate — FS offset=-30 (order 30 days before event)", () => {
  it("shifts order task by event delta when event moves", () => {
    // Event ends 2025-09-30; order starts 30 days before that = 2025-09-01 (duration 5)
    const ev = makeEvent("ev1", "2025-09-15", "2025-09-30");
    const order = makeTask("order1", "2025-09-01", "2025-09-06", "Order parts");
    const link = makeLink("order1", "event", "ev1", {
      dependencyType: "FS",
      offsetDays: -30,
    });

    // Event slips +10 days → new end 2025-10-10
    const result = recalculate(
      new Map([["ev1", { startDate: d("2025-09-25"), endDate: d("2025-10-10") }]]),
      new Map([["ev1", ev]]),
      new Map([["order1", order]]),
      [link]
    );

    const delta = result.changedTasks[0]!;
    // new start = 2025-10-10 + (-30) = 2025-09-10
    expect(delta.newStartDate).toEqual(d("2025-09-10"));
    expect(delta.deltaDays).toBe(9); // 2025-09-10 - 2025-09-01 = 9 days
  });
});
