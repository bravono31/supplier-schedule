/**
 * Gantt image import page.
 *
 * 1. User uploads image (drag & drop or file picker).
 * 2. Image is sent to /imports which calls Gemini API.
 * 3. Extracted events are shown in a review table.
 * 4. User edits/removes events and confirms.
 * 5. Confirmed events are saved to DB via /imports/:id/confirm.
 */

import { useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import type { ExtractedEvent, OemEventType } from "@supplier-schedule/shared";

interface ExtractionResult {
  sourceImageId: string;
  events: ExtractedEvent[];
  extractedAt: string;
}

type ReviewEvent = ExtractedEvent & { keep: boolean };

export function ImportPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [sourceImageId, setSourceImageId] = useState<string | null>(null);
  const [reviewEvents, setReviewEvents] = useState<ReviewEvent[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    if (!projectId) return;
    setExtracting(true);
    setError(null);
    setReviewEvents([]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("projectId", projectId);
      const result = await api.upload<ExtractionResult>("/imports", fd);
      setSourceImageId(result.sourceImageId);
      setReviewEvents(result.events.map((ev) => ({ ...ev, keep: true })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtracting(false);
    }
  };

  const confirm = async () => {
    if (!projectId || !sourceImageId) return;
    setSaving(true);
    try {
      const toSave = reviewEvents.filter((ev) => ev.keep);
      await api.post(`/imports/${sourceImageId}/confirm`, {
        projectId,
        events: toSave.map((ev) => ({
          name: ev.name,
          type: ev.type,
          startDate: ev.startDate,
          endDate: ev.endDate,
          isMilestone: ev.isMilestone,
          confidence: ev.confidence,
        })),
      });
      navigate(`/projects/${projectId}/gantt`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const updateEvent = (index: number, updates: Partial<ReviewEvent>) => {
    setReviewEvents((prev) =>
      prev.map((ev, i) => (i === index ? { ...ev, ...updates } : ev))
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <button onClick={() => navigate(`/projects/${projectId}/gantt`)}>
          ← ガント表示に戻る
        </button>
        <h1>ガント画像取込</h1>
      </div>

      <p style={{ marginBottom: 16, color: "#555" }}>
        OEM配布のガントチャート画像をアップロードします。<br />
        <strong>注意:</strong> 画像はGemini APIへ送信されます。社外秘領域は事前にトリミングしてください。
      </p>

      {/* Upload zone */}
      {!reviewEvents.length && (
        <div
          className={`import-dropzone${dragging ? " over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) void upload(file);
          }}
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          {extracting ? (
            <p>Gemini APIで解析中... しばらくお待ちください</p>
          ) : (
            <>
              <p style={{ fontSize: 16, margin: "0 0 8px" }}>📷 画像をドロップ or クリックして選択</p>
              <p style={{ color: "#888", margin: 0 }}>JPEG, PNG, PDF 対応 (最大20MB)</p>
            </>
          )}
        </div>
      )}

      {error && (
        <div style={{ background: "#fee", border: "1px solid #f00", borderRadius: 4, padding: 12, margin: "16px 0" }}>
          <strong>エラー:</strong> {error}
        </div>
      )}

      {/* Review table */}
      {reviewEvents.length > 0 && (
        <>
          <h2 style={{ margin: "24px 0 8px" }}>
            抽出結果レビュー（{reviewEvents.filter((e) => e.keep).length}/{reviewEvents.length}件選択）
          </h2>
          <p style={{ color: "#555", marginBottom: 12 }}>
            名称・種別・日付を確認・修正してから確定してください。不要なイベントは「除外」してください。
          </p>

          <table>
            <thead>
              <tr>
                <th>含める</th>
                <th>名称</th>
                <th>種別</th>
                <th>開始日</th>
                <th>終了日</th>
                <th>M石</th>
                <th>信頼度</th>
              </tr>
            </thead>
            <tbody>
              {reviewEvents.map((ev, i) => (
                <tr key={i} style={{ opacity: ev.keep ? 1 : 0.4 }}>
                  <td>
                    <input
                      type="checkbox"
                      checked={ev.keep}
                      onChange={(e) => updateEvent(i, { keep: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      value={ev.name}
                      onChange={(e) => updateEvent(i, { name: e.target.value })}
                      style={{ width: "100%", padding: "3px 6px", border: "1px solid #ccc", borderRadius: 3 }}
                    />
                  </td>
                  <td>
                    <select
                      value={ev.type}
                      onChange={(e) => updateEvent(i, { type: e.target.value as OemEventType })}
                    >
                      <option value="event">event</option>
                      <option value="test">test</option>
                      <option value="delivery">delivery</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="date"
                      value={ev.startDate}
                      onChange={(e) => updateEvent(i, { startDate: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={ev.endDate}
                      onChange={(e) => updateEvent(i, { endDate: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={ev.isMilestone}
                      onChange={(e) => updateEvent(i, { isMilestone: e.target.checked })}
                    />
                  </td>
                  <td>
                    <span className={ev.confidence >= 0.7 ? "confidence-ok" : "confidence-low"}>
                      {(ev.confidence * 100).toFixed(0)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button onClick={() => setReviewEvents([])} disabled={saving}>
              やり直す
            </button>
            <button
              className="primary"
              onClick={() => void confirm()}
              disabled={saving || reviewEvents.filter((e) => e.keep).length === 0}
            >
              {saving ? "保存中..." : `${reviewEvents.filter((e) => e.keep).length}件を確定`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
