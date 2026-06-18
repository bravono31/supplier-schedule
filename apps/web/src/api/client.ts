/**
 * Thin fetch wrapper for the API.
 * All requests go to /api/* which Vite proxies to localhost:3001.
 */

const BASE = "/api";

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, init);

  if (res.status === 204) return undefined as T;

  const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: (path: string) => request<void>("DELETE", path),

  /** Upload image with multipart/form-data */
  upload: async <T>(path: string, formData: FormData): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      body: formData,
    });
    const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
    if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json.data as T;
  },
};
