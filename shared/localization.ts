export type Split = "train" | "val" | "test";
export type XYXY = [number, number, number, number];
export type Matrix3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };
export interface Evidence {
  [key: string]: Json;
}
export interface LocEvent {
  id: string;
  voice: string;
  centerX: number | null;
  bbox: XYXY | null;
  contextBBox: XYXY | null;
  status: "candidate" | "accepted" | "rejected";
  evidence: Evidence;
  annotationSource: Evidence;
  confidence: number | null;
  rhythm?: RhythmLabel;
}
export type RhythmDuration = 1 | 2 | 4 | 8 | 16 | 32;
export interface RhythmLabel {
  duration: RhythmDuration | null;
}
export interface RhythmRegion {
  id: string; pageId: string; systemId: string | null;
  track: "guitar" | "melody" | "lyrics"; bbox: XYXY;
}
export interface Measure {
  id: string;
  pageId: string;
  systemId: string | null;
  barNumber: number | null;
  track: "guitar" | "melody" | "lyrics";
  regionId?: string | null;
  voice: string;
  bbox: XYXY | null;
  staffLines: number[] | null;
  events: LocEvent[];
  geometryConfirmed: boolean;
  completenessConfirmed: boolean;
  reviewNote: string;
}
export interface SourcePage {
  localPageId: string;
  sourcePageId: string;
  sourceSha: string;
  pixelSha: string | null;
  width: number;
  height: number;
  mapping: Matrix3;
  historicalSha?: string;
  pixelEquivalence?: {
    mode: "decoded-rgb-v1";
    rgbSha256: string;
    platformSha256: string;
    historicalSha256: string;
  };
}
export interface Geometry {
  schemaVersion: "omr-localization-v1" | "omr-rhythm-v1";
  regions?: RhythmRegion[];
  pages: SourcePage[];
  measures: Measure[];
}
export interface LocalizationRecord {
  confirmed_at: string | null;
  id: string;
  dataset_id: string;
  corpus_id: string;
  corpus_revision: number;
  source_fingerprint: string;
  input_checksum: string;
  original: Json;
  geometry: Geometry;
  title: string;
  group_key: string;
  split: Split;
  source: string;
  version: number;
  status: "draft" | "confirmed";
  updated_at: string;
}
export interface LocDataset {
  task?: "geometry" | "rhythm";
  source_dataset_id?: string | null;
  source_name?: string | null;
  updated_at: string;
  id: string;
  name: string;
  description: string;
  version: number;
  record_count?: number;
  confirmed_count?: number;
}
export interface CorpusImport {
  geometry?: Geometry;
  corpus: unknown;
  sourcePageMap: Record<string, string>;
}
