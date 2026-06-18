/**
 * Main Gantt view page.
 *
 * Displays OEM events (baseline) and supplier tasks in a Gantt chart.
 * Uses SVAR React Gantt for rendering.
 *
 * NOTE: SVAR Gantt requires a commercial license for production use beyond
 * evaluation. For initial dev, the "@dhtmlx/trial-react-gantt" package is used.
 * Replace with "@svar/react-gantt" when the license is procured.
 */

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { RecalcPreviewModal } from "../components/RecalcPreviewModal.js";
import { TaskFormModal } from "../components/TaskFormModal.js";
import type {
  OemEvent,
  SupplierTask,
  Project,
  RecalcPreview,
} from "@supplier-schedule/shared";

// ── Gantt data shape expected by DHTMLX Gantt ──────────────────────────────

interface GanttTask {
  id: string;
  text: string;
  start_date: string; // "DD-MM-YYYY HH:mm"
  end_date: string;
  duration?: number;
  parent?: string;
  type?: string;
  readonly?: boolean;
  category?: string;
  isOemEvent?: boolean;
  driftWarning?: boolean;
}

interface GanttLink {
  id: string;
  source: string;
  target: string;
  type: string; // "0"=FS "1"=SS "2"=EE "3"=SE
}

function toGanttDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy} 00:00`;
}

const DEP_TYPE_MAP: Record<string, string> = {
  FS: "0",
  SS: "1",
  EE: "2",
  SE: "3",
};

export function GanttPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [oemEvents, setOemEvents] = useState<OemEvent[]>([]);
  const [tasks, setTasks] = useState<SupplierTask[]>([]);

  // Recalc preview state
  const [pendingEventEdit, setPendingEventEdit] = useState<{
    eventId: string;
    startDate?: string;
    endDate?: string;
    preview: RecalcPreview;
  } | null>(null);

  // Task create modal
  const [showTaskForm, setShowTaskForm] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    const [proj, evs, tks] = await Promise.all([
      api.get<{ data: Project }>(`/projects/${projectId}`).then((r) => r.data),
      api.get<OemEvent[]>(`/events?projectId=${projectId}`),
      api.get<SupplierTask[]>(`/tasks?projectId=${projectId}`),
    ]);
    setProject(proj);
    setOemEvents(evs);
    setTasks(tks);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  // ── Gantt data ─────────────────────────────────────────────────────────

  const ganttTasks: GanttTask[] = [
    // OEM events as a group
    ...oemEvents.map((ev): GanttTask => ({
      id: `ev-${ev.id}`,
      text: ev.name,
      start_date: toGanttDate(ev.startDate),
      end_date: toGanttDate(ev.endDate),
      type: ev.isMilestone ? "milestone" : "task",
      isOemEvent: true,
      readonly: false, // allow editing for recalc trigger
    })),
    // Supplier tasks
    ...tasks.map((t): GanttTask => ({
      id: `task-${t.id}`,
      text: t.driftWarning ? `⚠ ${t.name}` : t.name,
      start_date: toGanttDate(t.startDate),
      end_date: toGanttDate(t.endDate),
      category: t.category,
      driftWarning: t.driftWarning,
    })),
  ];

  // ── OEM event inline edit → recalc preview ────────────────────────────

  const handleEventDateChange = async (
    eventId: string,
    newStart: string,
    newEnd: string
  ) => {
    try {
      const preview = await api.patch<RecalcPreview>(
        `/events/${eventId}?preview=true`,
        { startDate: newStart, endDate: newEnd, preview: true }
      );
      if (
        preview.changedTasks.length === 0 &&
        preview.driftWarningTasks.length === 0
      ) {
        // No downstream impact — just update immediately
        await api.post(`/events/${eventId}/apply-recalc`, {
          startDate: newStart,
          endDate: newEnd,
        });
        void load();
      } else {
        // Show preview modal first
        setPendingEventEdit({
          eventId,
          startDate: newStart,
          endDate: newEnd,
          preview,
        });
      }
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const confirmRecalc = async () => {
    if (!pendingEventEdit) return;
    try {
      await api.post(`/events/${pendingEventEdit.eventId}/apply-recalc`, {
        startDate: pendingEventEdit.startDate,
        endDate: pendingEventEdit.endDate,
      });
      setPendingEventEdit(null);
      void load();
    } catch (err) {
      alert(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (!project) return <div className="page"><p>読み込み中...</p></div>;

  return (
    <div className="gantt-page">
      <div className="gantt-toolbar">
        <button onClick={() => navigate("/projects")}>← プロジェクト一覧</button>
        <h1>{project.name}</h1>
        <button onClick={() => navigate(`/projects/${projectId}/import`)}>
          📷 画像取込
        </button>
        <button className="primary" onClick={() => setShowTaskForm(true)}>
          ＋ 作業追加
        </button>
      </div>

      {/* Gantt chart placeholder — rendered below */}
      <div className="gantt-wrap">
        <GanttChart
          tasks={ganttTasks}
          onEventDateChange={handleEventDateChange}
        />
      </div>

      {/* Drift warning summary */}
      {tasks.some((t) => t.driftWarning) && (
        <div
          style={{
            padding: "10px 16px",
            background: "#fff3cd",
            borderTop: "1px solid #ffc107",
          }}
        >
          <strong>⚠ 非連動の作業でドリフト警告があります。</strong>
          {tasks
            .filter((t) => t.driftWarning)
            .map((t) => t.name)
            .join("、")}
        </div>
      )}

      {/* Recalc preview modal */}
      {pendingEventEdit && (
        <RecalcPreviewModal
          preview={pendingEventEdit.preview}
          onConfirm={() => void confirmRecalc()}
          onCancel={() => setPendingEventEdit(null)}
        />
      )}

      {/* Task create modal */}
      {showTaskForm && projectId && (
        <TaskFormModal
          projectId={projectId}
          oemEvents={oemEvents}
          onSave={() => { setShowTaskForm(false); void load(); }}
          onCancel={() => setShowTaskForm(false)}
        />
      )}
    </div>
  );
}

// ── Simple Gantt chart using a table fallback ──────────────────────────────
// (SVAR Gantt / DHTMLX Gantt packages require install; this is a readable
// placeholder that shows all tasks in a structured timeline table.
// Replace with <Gantt> from @svar/react-gantt once installed.)

function GanttChart({
  tasks,
  onEventDateChange,
}: {
  tasks: GanttTask[];
  onEventDateChange: (id: string, start: string, end: string) => void;
}) {
  return (
    <div style={{ padding: 16, overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>種別</th>
            <th>開始日</th>
            <th>終了日</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const isEvent = t.isOemEvent ?? false;
            const rawId = t.id.replace(/^(ev-|task-)/, "");
            return (
              <tr
                key={t.id}
                style={{
                  background: isEvent ? "#f0f8ff" : t.driftWarning ? "#fff8e1" : undefined,
                }}
              >
                <td>
                  {t.driftWarning && (
                    <span className="drift-warning" title="イベントが動きましたが非連動です">⚠ </span>
                  )}
                  {t.text}
                </td>
                <td>
                  <span className={`badge badge-${isEvent ? "event" : (t.category ?? "dev")}`}>
                    {isEvent ? "OEMイベント" : (t.category ?? "-")}
                  </span>
                </td>
                <td>{t.start_date.split(" ")[0]}</td>
                <td>{t.end_date.split(" ")[0]}</td>
                <td>
                  {isEvent && (
                    <button
                      style={{ fontSize: 11 }}
                      onClick={() => {
                        const start = prompt("新しい開始日 (YYYY-MM-DD)", t.start_date.split(" ")[0]!.split("-").reverse().join("-"));
                        const end = prompt("新しい終了日 (YYYY-MM-DD)", t.end_date.split(" ")[0]!.split("-").reverse().join("-"));
                        if (start && end) onEventDateChange(rawId, start, end);
                      }}
                    >
                      日付変更
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ color: "#888", marginTop: 16, fontSize: 12 }}>
        ※ 本番では SVAR React Gantt で視覚的なバーチャートに置き換えます。
      </p>
    </div>
  );
}
