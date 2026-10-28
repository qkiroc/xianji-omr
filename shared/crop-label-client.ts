import { api } from "./client";
import { keyLabelComplete, type KeyLabel } from "./key-signatures";
import { COMMON_TIME_SIGNATURES, timeSignatureComplete } from "./time-signatures";
export type CropLabelTask = "key-signatures" | "time-signatures";
export const cropTaskName = (task: CropLabelTask) => task === "time-signatures" ? "拍号" : "调号";
export function cropLabelComplete(task: CropLabelTask, label: KeyLabel) {
  if (task === "key-signatures") return keyLabelComplete(label);
  const [numerator, denominator] = (label.tonic || "").split("/").map(Number);
  return timeSignatureComplete({ numerator, denominator });
}
function normalizeTimeValue(value: any): any {
  if (Array.isArray(value)) return value.map(normalizeTimeValue);
  if (!value || typeof value !== "object") return value;
  if ("numerator" in value && "denominator" in value)
    return { ...value, tonic: value.numerator === null ? null : value.numerator + "/" + value.denominator, kind: value.numerator === null ? null : "play" };
  return { ...value, ...(value.items ? { items: value.items.map(normalizeTimeValue) } : {}),
    ...(value.record ? { record: normalizeTimeValue(value.record) } : {}) };
}
export async function cropApi<T>(task: CropLabelTask, path: string, options: RequestInit = {}): Promise<T> {
  let next = options;
  if (task === "time-signatures" && options.method === "PUT" && typeof options.body === "string") {
    const label = JSON.parse(options.body);
    const [numerator, denominator] = String(label.tonic || "").split("/").map(Number);
    next = { ...options, body: JSON.stringify({ version: label.version, numerator, denominator }) };
  }
  const value = await api<T>(path, next);
  return task === "time-signatures" ? normalizeTimeValue(value) : value;
}
export function timeSignatureShortcut(key: string, label: KeyLabel) {
  if (!/^[0-9]$/.test(key)) return null;
  const pair = COMMON_TIME_SIGNATURES[key === "0" ? 9 : Number(key)-1];
  return { label: { ...label, tonic: pair.join("/"), kind: "play" as const }, accidental: "" };
}