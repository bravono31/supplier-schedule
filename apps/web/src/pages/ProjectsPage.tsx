import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import type { Project } from "@supplier-schedule/shared";

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = async () => {
    try {
      const data = await api.get<Project[]>("/projects");
      setProjects(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (!newName.trim()) return;
    await api.post("/projects", { name: newName.trim(), description: null });
    setNewName("");
    void load();
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`「${name}」を削除しますか？（すべてのイベント・作業も削除されます）`)) return;
    await api.delete(`/projects/${id}`);
    void load();
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>プロジェクト一覧</h1>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void create()}
          placeholder="新規プロジェクト名"
          style={{ flex: 1, padding: "6px 10px", borderRadius: 4, border: "1px solid #ccc" }}
        />
        <button className="primary" onClick={() => void create()}>作成</button>
      </div>

      {loading ? (
        <p>読み込み中...</p>
      ) : projects.length === 0 ? (
        <p style={{ color: "#888" }}>プロジェクトがありません。上のフォームから作成してください。</p>
      ) : (
        <div className="card-list">
          {projects.map((p) => (
            <div className="card" key={p.id}>
              <div>
                <h2>{p.name}</h2>
                <p>{new Date(p.createdAt).toLocaleDateString("ja-JP")}</p>
              </div>
              <div className="card-actions">
                <button onClick={() => navigate(`/projects/${p.id}/gantt`)}>ガント表示</button>
                <button onClick={() => navigate(`/projects/${p.id}/import`)}>画像取込</button>
                <button className="danger" onClick={() => void remove(p.id, p.name)}>削除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
