import { supabase } from "./supabase";

const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "http://127.0.0.1:8010").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(query?: Query) {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query; form?: FormData } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${qs(opts.query)}`, { method, headers, body });
  } catch {
    throw new ApiError(0, "Cannot reach the ACME Clinical API. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    const detail = (json && typeof json === "object" && "detail" in json ? (json as { detail: unknown }).detail : null) ?? res.statusText;
    if (res.status === 401) await supabase.auth.signOut();
    throw new ApiError(res.status, typeof detail === "string" ? detail : "Request failed");
  }
  return json as T;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>("GET", path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, { form }),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError || e instanceof Error) return e.message;
  return "Something went wrong";
}
