/**
 * Modal shown before applying a recalculation.
 * Displays which tasks will shift and which will receive drift warnings.
 */

import type { RecalcPreview } from "@supplier-schedule/shared";

interface Props {
  preview: RecalcPreview;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RecalcPreviewModal({ preview, onConfirm, onCancel }: Props) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>日程変更の影響プレビュー</h2>
        <p>以下の変更が適用されます。確定してよいですか？</p>

        {preview.changedTasks.length > 0 && (
          <>
            <h3 style={{ fontSize: 14, margin: "16px 0 8px" }}>
              🔄 連動して移動する作業（{preview.changedTasks.length}件）
            </h3>
            <table>
              <thead>
                <tr>
                  <th>作業名</th>
                  <th>旧開始日</th>
                  <th>新開始日</th>
                  <th>移動日数</th>
                </tr>
              </thead>
              <tbody>
                {preview.changedTasks.map((t) => (
                  <tr key={t.taskId}>
                    <td>{t.taskName}</td>
                    <td>{t.oldStartDate.toString().slice(0, 10)}</td>
                    <td>{t.newStartDate.toString().slice(0, 10)}</td>
                    <td>
                      <span
                        style={{
                          fontWeight: 600,
                          color: t.deltaDays > 0 ? "#cc5500" : "#2e7d32",
                        }}
                      >
                        {t.deltaDays > 0 ? `+${t.deltaDays}` : t.deltaDays}日
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {preview.driftWarningTasks.length > 0 && (
          <>
            <h3 style={{ fontSize: 14, margin: "16px 0 8px" }}>
              ⚠ 非連動のためドリフト警告が設定される作業（{preview.driftWarningTasks.length}件）
            </h3>
            <ul style={{ margin: "0 0 8px", paddingLeft: 20 }}>
              {preview.driftWarningTasks.map((t) => (
                <li key={t.taskId} className="drift-warning">
                  {t.taskName}
                </li>
              ))}
            </ul>
            <p style={{ fontSize: 12, color: "#888" }}>
              これらの作業は日付が固定のままです。後で手動で調整するか、連動設定に変更してください。
            </p>
          </>
        )}

        <div className="modal-footer">
          <button onClick={onCancel}>キャンセル</button>
          <button className="primary" onClick={onConfirm}>
            確定して適用
          </button>
        </div>
      </div>
    </div>
  );
}
