// ======================================================
// Domain types shared between frontend and backend
// ======================================================

/** OEM event types extracted from Gantt images */
export type OemEventType = "event" | "test" | "delivery";

/** Supplier task categories */
export type TaskCategory = "dev" | "order" | "doc" | "test_prep";

/** Task status */
export type TaskStatus = "not_started" | "in_progress" | "done" | "on_hold";

/** Link dependency types (Finish-to-Start, Start-to-Start, etc.) */
export type DependencyType = "FS" | "SS" | "EE" | "SE";

// ──────────────────────────────────────────────────────
// Project
// ──────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string;
}

export type ProjectCreateInput = Pick<Project, "name" | "description">;
export type ProjectUpdateInput = Partial<ProjectCreateInput>;

// ──────────────────────────────────────────────────────
// OEM Event (baseline schedule from Gantt image)
// ──────────────────────────────────────────────────────

export interface OemEvent {
  id: string;
  projectId: string;
  name: string;
  type: OemEventType;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
  isMilestone: boolean;
  sourceImageId: string | null;
  extractionConfidence: number | null; // 0.0 – 1.0
  createdAt: string;
  updatedAt: string;
}

export type OemEventCreateInput = Pick<
  OemEvent,
  "projectId" | "name" | "type" | "startDate" | "endDate" | "isMilestone"
> &
  Partial<Pick<OemEvent, "sourceImageId" | "extractionConfidence">>;

export type OemEventUpdateInput = Partial<
  Pick<OemEvent, "name" | "type" | "startDate" | "endDate" | "isMilestone">
>;

// ──────────────────────────────────────────────────────
// Supplier Task (supplier-side work items)
// ──────────────────────────────────────────────────────

export interface SupplierTask {
  id: string;
  projectId: string;
  name: string;
  category: TaskCategory;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;   // "YYYY-MM-DD"
  status: TaskStatus;
  driftWarning: boolean; // true when a linked event moved but this task is non-linked
  createdAt: string;
  updatedAt: string;
}

export type SupplierTaskCreateInput = Pick<
  SupplierTask,
  "projectId" | "name" | "category" | "startDate" | "endDate"
> &
  Partial<Pick<SupplierTask, "status">>;

export type SupplierTaskUpdateInput = Partial<
  Pick<SupplierTask, "name" | "category" | "startDate" | "endDate" | "status">
>;

// ──────────────────────────────────────────────────────
// Link (dependency / anchor between task and event or task)
// ──────────────────────────────────────────────────────

/** Anchor target — either an OEM event or another supplier task */
export type AnchorTarget =
  | { kind: "event"; eventId: string }
  | { kind: "task"; taskId: string };

export interface Link {
  id: string;
  /** The supplier task that is being scheduled relative to the anchor */
  taskId: string;
  anchor: AnchorTarget;
  dependencyType: DependencyType;
  /**
   * Days offset from the anchor's reference date.
   * Negative = before the anchor.
   * e.g. offset=-30 with FS means start 30 days before anchor ends.
   */
  offsetDays: number;
  /**
   * When true: if the anchor date changes, this task's dates are
   * automatically recalculated (offsetDays is preserved).
   * When false: task dates are frozen; a driftWarning is set instead.
   */
  isLinked: boolean;
  createdAt: string;
  updatedAt: string;
}

export type LinkCreateInput = Pick<
  Link,
  "taskId" | "anchor" | "dependencyType" | "offsetDays" | "isLinked"
>;

export type LinkUpdateInput = Partial<
  Pick<Link, "dependencyType" | "offsetDays" | "isLinked">
>;

// ──────────────────────────────────────────────────────
// Recalculation preview
// ──────────────────────────────────────────────────────

export interface TaskDateDelta {
  taskId: string;
  taskName: string;
  oldStartDate: string;
  newStartDate: string;
  oldEndDate: string;
  newEndDate: string;
  deltaDays: number;
}

export interface RecalcPreview {
  changedTasks: TaskDateDelta[];
  driftWarningTasks: Array<{ taskId: string; taskName: string }>;
}

// ──────────────────────────────────────────────────────
// Image extraction
// ──────────────────────────────────────────────────────

/** Raw extracted event from Gemini before user review */
export interface ExtractedEvent {
  name: string;
  type: OemEventType;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;
  isMilestone: boolean;
  confidence: number; // 0.0 – 1.0
}

export interface ExtractionResult {
  sourceImageId: string;
  events: ExtractedEvent[];
  rawPromptTokens?: number;
  extractedAt: string;
}

// ──────────────────────────────────────────────────────
// API response wrappers
// ──────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
  details?: unknown;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
