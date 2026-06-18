/**
 * Modal form for creating a new supplier task with optional anchor link.
 */

import { useState } from "react";
import { api } from "../api/client.js";
import type {
  OemEvent,
  TaskCategory,
  DependencyType,
  AnchorTarget,
} from "@supplier-schedule/shared";

interface Props {
  projectId: string;
  oemEvents: OemEvent[];
  onSave: () => void;
  onCancel: () => void;
}

export function TaskFormModal({ projectId, oemEvents, onSave, onCancel }: Props) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<TaskCategory>("dev");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [anchorEventId, setAnchorEventId] = useState("");
  const [depType, setDepType] = useState<DependencyType>("FS");
  const [offsetDays, setOffsetDays] = useState(0);
  const [isLinked, setIsLinked] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim() || !startDate || !endDate) {
      setError("名称・開始日・終了日は必須です");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const task = await api.post<{ id: string }>("/tasks", {
        projectId,
        name: name.trim(),
        category,
        startDate,
        endDate,
      });

      // Create anchor link if event selected
      if (anchorEventId) {
        const anchor: AnchorTarget = { kind: "event", eventId: anchorEventId };
        await api.post("/links", {
          taskId: task.id,
          anchor,
          dependencyType: depType,
          offsetDays,
          isLinked,
        });
      }

      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>作業追加</h2>

        {error && (
          <div style={{ color: "#c00", marginBottom: 12, fontSize: 13 }}>{error}</div>
        )}

        <table style={{ width: "100%" }}>
          <tbody>
            <tr>
              <td style={{ width: 120, fontWeight: 600 }}>作業名 *</td>
              <td>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ width: "100%", padding: "4px 8px", border: "1px solid #ccc", borderRadius: 3 }}
                />
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>カテゴリ</td>
              <td>
                <select value={category} onChange={(e) => setCategory(e.target.value as TaskCategory)}>
                  <option value="dev">開発 (dev)</option>
                  <option value="order">発注 (order)</option>
                  <option value="doc">資料 (doc)</option>
                  <option value="test_prep">試験準備 (test_prep)</option>
                </select>
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>開始日 *</td>
              <td><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600 }}>終了日 *</td>
              <td><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></td>
            </tr>
          </tbody>
        </table>

        <hr style={{ margin: "16px 0", borderColor: "#eee" }} />
        <p style={{ margin: "0 0 8px", fontWeight: 600 }}>OEMイベントへのアンカー（任意）</p>

        <table style={{ width: "100%" }}>
          <tbody>
            <tr>
              <td style={{ width: 120 }}>基準イベント</td>
              <td>
                <select value={anchorEventId} onChange={(e) => setAnchorEventId(e.target.value)}>
                  <option value="">— なし —</option>
                  {oemEvents.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name} ({ev.startDate.slice(0, 10)}〜{ev.endDate.slice(0, 10)})
                    </option>
                  ))}
                </select>
              </td>
            </tr>
            {anchorEventId && (
              <>
                <tr>
                  <td>依存タイプ</td>
                  <td>
                    <select value={depType} onChange={(e) => setDepType(e.target.value as DependencyType)}>
                      <option value="FS">FS — イベント終了後に開始</option>
                      <option value="SS">SS — イベント開始と同時に開始</option>
                      <option value="EE">EE — イベント終了と同時に終了</option>
                      <option value="SE">SE — イベント開始時に終了</option>
                    </select>
                  </td>
                </tr>
                <tr>
                  <td>オフセット（日）</td>
                  <td>
                    <input
                      type="number"
                      value={offsetDays}
                      onChange={(e) => setOffsetDays(Number(e.target.value))}
                      style={{ width: 80 }}
                    />
                    <span style={{ marginLeft: 6, fontSize: 12, color: "#888" }}>
                      負=前倒し（例: -30 = 30日前）
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>連動</td>
                  <td>
                    <label>
                      <input
                        type="checkbox"
                        checked={isLinked}
                        onChange={(e) => setIsLinked(e.target.checked)}
                      />{" "}
                      イベントがずれたら自動で日付を更新する
                    </label>
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>

        <div className="modal-footer">
          <button onClick={onCancel} disabled={saving}>キャンセル</button>
          <button className="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "保存中..." : "追加"}
          </button>
        </div>
      </div>
    </div>
  );
}
