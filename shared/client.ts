export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api" + path, {
    ...options,
    cache: "no-store",
  });
  const value = await response.json().catch(() => ({ error: "服务响应无效" }));
  if (!response.ok)
    throw new ApiError(value.error || "请求失败", response.status);
  return value as T;
}
export const json = (value: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});
export const clone = <T>(value: T): T => structuredClone(value);
export interface Category {
  id: number;
  key: string;
  name: string;
  color: string;
}
export interface Box {
  id: string;
  classKey: string | null;
  parentSystemId: string | null;
  readingOrder: number;
  x: number;
  y: number;
  width: number;
  height: number;
  metadata?: {
    scope: "page" | "global" | "local";
    rawText?: string;
    value?: Record<string, string | number | boolean>;
  };
  reviewStatus?: "draft" | "confirmed" | "needs_adjustment";
}
export interface PageImage {
  id: string;
  name: string;
  width: number;
  height: number;
  version: number;
  songId: string;
  datasetId: string;
  status: "draft" | "ai_reviewed" | "confirmed";
  pageOrder: number;
  pageType: "music" | "negative";
  annotationFormat: string;
  coordinate: unknown;
  source: string;
  updatedAt?: string;
}
export interface LayoutDocument {
  image: PageImage;
  boxes: Box[];
  deletedBoxes: Box[];
}
export interface Song {
  id: string;
  dataset_id: string;
  name: string;
  song_group_key: string;
  split: string;
  version: number;
  page_count: number;
  confirmed_count: number;
  box_count: number;
  first_page_id: string | null;
  page_revision: string;
  deleted_at: string | null;
  updated_at: string;
}
export interface Dataset {
  id: string;
  name: string;
  description: string;
  version: number;
  page_count: number;
  confirmed_count: number;
  box_count: number;
  updated_at: string;
  deleted_at: string | null;
}
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export function useQueryString(
  params: URLSearchParams,
  changes: Record<string, string | number | undefined>,
) {
  const next = new URLSearchParams(params);
  for (const [k, v] of Object.entries(changes))
    if (v === undefined || v === "") next.delete(k);
    else next.set(k, String(v));
  return next.toString();
}
// getRandomValues is available on explicitly permitted HTTP origins as well.
export function clientId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
