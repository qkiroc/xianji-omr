import type { Geometry, LocalizationRecord } from "./localization";
type DraftStorage = Pick<Storage,"getItem"|"setItem"|"removeItem">;
const key = (record: LocalizationRecord) => "omr-region-draft:"+record.id;
export function keepRegionDraft(storage: DraftStorage, record: LocalizationRecord, geometry: Geometry): boolean {
  try {
    storage.setItem(key(record),JSON.stringify({recordId:record.id,datasetId:record.dataset_id,version:record.version,
      fingerprint:record.source_fingerprint,pages:record.geometry.pages,regions:record.geometry.regions,sample:record.geometry.sample,geometry}));
    return true;
  } catch {return false;}
}
export function readRegionDraft(storage: DraftStorage, record: LocalizationRecord): Geometry | null {
  try {
    const value=JSON.parse(storage.getItem(key(record)) || "null");
    if (!value || value.recordId!==record.id || value.datasetId!==record.dataset_id || value.version!==record.version ||
      value.fingerprint!==record.source_fingerprint || JSON.stringify(value.pages)!==JSON.stringify(record.geometry.pages) ||
      JSON.stringify(value.regions)!==JSON.stringify(record.geometry.regions) || JSON.stringify(value.sample)!==JSON.stringify(record.geometry.sample) || value.geometry?.schemaVersion!=="omr-rhythm-v1") return null;
    return value.geometry as Geometry;
  } catch {return null;}
}
export function clearRegionDraft(storage: DraftStorage, record: LocalizationRecord): void {
  try {storage.removeItem(key(record));}catch { /* Saving to the server still succeeds if local storage is unavailable. */ }
}
