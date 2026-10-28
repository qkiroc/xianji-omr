"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Progress } from "antd";
import { COMMON_TIME_SIGNATURES, TIME_DENOMINATORS } from "../../shared/time-signatures";
import { cropApi, cropLabelComplete, cropTaskName, timeSignatureShortcut, type CropLabelTask } from "../../shared/crop-label-client";
import { Button, Input, Select } from "../ui/antd";
import { ErrorToast } from "../ui/toast";
import { useDirty, useNavigation } from "../navigation";
import { api, json } from "../../shared/client";
import {
  KEY_NOTES, KEY_ACCIDENTALS, keyLabelComplete, keyShortcut,
  type KeyLabel, type KeyRecord, type KeyWorkspace,
} from "../../shared/key-signatures";
const labelOf = (r: KeyRecord): KeyLabel => ({ tonic: r.tonic, kind: r.kind });
const sameLabel = (a: KeyLabel, b: KeyLabel) => a.tonic === b.tonic && a.kind === b.kind;
const prettyTonic = (tonic: string) => tonic.replace("b", "♭").replace("#", "♯");

export function KeyEditor({ datasetId, task = "key-signatures" }: { datasetId: string; task?: CropLabelTask }) {
  const timeSignature = task === "time-signatures", taskName = cropTaskName(task);
  const { go } = useNavigation();
  const base = "/v2/" + task + "/datasets/" + datasetId;
  const [workspace, setWorkspace] = useState<KeyWorkspace | null>(null);
  const [drafts, setDrafts] = useState<Record<string, KeyRecord>>({});
  const [accidental, setAccidental] = useState("");
  const [busy, setBusy] = useState(true);
  const working = useRef(false);
  const mounted = useRef(true);
  const listQuery = useRef("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [imageReady, setImageReady] = useState("");
  const [imageError, setImageError] = useState("");
  const record = workspace?.record ?? null;
  const label: KeyLabel = record ? (drafts[record.id] ?? labelOf(record)) : { tonic: null, kind: null };
  const pendingDrafts = Object.values(drafts);
  const load = useCallback(async (recordId?: string, direction?: string) => {
    const q = new URLSearchParams();
    if (recordId) q.set("recordId", recordId);
    if (direction) q.set("direction", direction);
    const value = await cropApi<KeyWorkspace>(task, base + "/editor?" + q);
    if (!mounted.current) return;
    setWorkspace(value); setImageError("");
    if (value.record) {
      const urlQuery = new URLSearchParams(listQuery.current);
      urlQuery.set("recordId", value.record.id);
      window.history.replaceState({ ...window.history.state, omrReplace: true }, "", "/" + task + "/datasets/" + datasetId + "/annotate?" + urlQuery);
      setAccidental(value.record.tonic?.slice(1) || "");
    }
    return value;
  }, [base, datasetId, task]);
  useEffect(() => {
    mounted.current = true;
    setBusy(true);
    const initialQuery = new URLSearchParams(window.location.search);
    const initialRecord = initialQuery.get("recordId") || undefined;
    initialQuery.delete("recordId");
    listQuery.current = initialQuery.toString();
    void load(initialRecord)
      .catch((e) => { if (mounted.current) setError(e.message); })
      .finally(() => { if (mounted.current) setBusy(false); });
    return () => { mounted.current = false; };
  }, [load]);

  const saveOne = useCallback(async (r: KeyRecord) => {
    if (!cropLabelComplete(task, r)) throw Error(timeSignature ? "请选完整的拍号后再保存" : "请选择调号，并选择原调或选调后再保存");
    const saved = await cropApi<KeyRecord>(task, base + "/records/" + r.id, json({ tonic: r.tonic, kind: r.kind, version: r.version }, "PUT"));
    if (mounted.current) {
      setDrafts((old) => { const next = { ...old }; delete next[r.id]; return next; });
      setWorkspace((old) => old ? {
        ...old,
        record: old.record?.id === saved.id ? saved : old.record,
        dataset: { ...old.dataset, confirmed_count: old.dataset.confirmed_count + (r.status === "draft" ? 1 : 0) },
      } : old);
    }
    return saved;
  }, [base, task]);
  const saveAll = useCallback(async () => {
    if (working.current) throw Error("正在保存，请稍候");
    if (pendingDrafts.some((r) => !cropLabelComplete(task, r))) throw Error("还有未选完整的标注，请补齐内容后再保存");
    working.current = true; setBusy(true);
    try { for (const draft of pendingDrafts) await saveOne(draft); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }, [pendingDrafts, saveOne]);
  useDirty(pendingDrafts.length > 0, saveAll);

  const select = useCallback((next: KeyLabel) => {
    if (!record || busy || imageReady !== record.id || imageError) return;
    setNotice(""); setError("");
    setDrafts((old) => {
      const value = { ...old };
      if (sameLabel(next, labelOf(record))) delete value[record.id];
      else value[record.id] = { ...record, ...next };
      return value;
    });
  }, [record, busy, imageReady, imageError]);
  const move = useCallback(async (direction: "previous" | "next" | "pending") => {
    if (!record || working.current || busy) return;
    if (direction === "previous" && !workspace?.previousId) return;
    if (direction === "next" && !workspace?.nextId) return;
    working.current = true; setBusy(true); setError(""); setNotice("");
    try { await load(record.id, direction); }
    catch (e) { setError(e instanceof Error ? e.message : "切换失败"); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }, [record, workspace, busy, load]);
  const saveNext = useCallback(async () => {
    if (!record || working.current || busy || imageReady !== record.id || imageError) return;
    working.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await saveOne({ ...record, ...label });
      const next = await load(record.id, "pending");
      if (next) setNotice(next.dataset.confirmed_count === next.dataset.sample_count ? "已保存，全部切图已标注完成。" : "已保存，已切换到下一个待标注项。");
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败，选择已保留"); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }, [record, label, busy, imageReady, imageError, saveOne, load]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
        target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],.ant-modal,.ant-select')) return;
      if (event.repeat && ["Enter", "ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); return; }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault(); void move(event.key === "ArrowLeft" ? "previous" : "next"); return;
      }
      if (event.key === "Enter") { event.preventDefault(); void saveNext(); return; }
      const result = timeSignature ? timeSignatureShortcut(event.key, label) : keyShortcut(event, label, accidental);
      if (result) { event.preventDefault(); if (!busy) { setAccidental(result.accidental); select(result.label); } }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [label, accidental, move, saveNext, select, busy, timeSignature]);
  const disabled = busy || !record || imageReady !== record.id || !!imageError;
  const dataset = workspace?.dataset;
  return <div className="key-editor">
    <header className="key-editor-header">
      <Button type="button" onClick={() => go("/" + task + "/datasets/" + datasetId + (listQuery.current ? "?" + listQuery.current : ""))}>← 切图列表</Button>
      <div><h1>{dataset?.name || taskName + "标注"}</h1><span className="muted small">{dataset?.source_name ? "关联切图：" + dataset.source_name : taskName + "内容标注"}</span></div>
      <div className="spacer" />
      {dataset && <div className="key-progress"><span>{dataset.confirmed_count} / {dataset.sample_count} 已标注</span><Progress percent={dataset.sample_count ? Math.round(dataset.confirmed_count / dataset.sample_count * 100) : 0} size="small" showInfo={false} /></div>}
      <Button type="button" disabled={busy || !dataset?.source_dataset_id} onClick={async () => {
        if (working.current) return;
        working.current = true; setBusy(true); setError("");
        try {
          const result = await api<{ imported: number }>(base + "/sync", json({}));
          await load(record?.id);
          setNotice(`已导入 ${result.imported} 张新切图，已有标注已保留。`);
        } catch (e) { setError(e instanceof Error ? e.message : "导入失败"); }
        finally { working.current = false; if (mounted.current) setBusy(false); }
      }}>补充导入</Button>
      <a className="key-export" href={"/api" + base + "/export"}>导出标注 JSON</a>
    </header>
    <div className="key-editor-body">
      <ErrorToast>{error}</ErrorToast>
      {notice && <Alert type="success" showIcon title={notice} />}
      {dataset && dataset.sample_count > 0 && dataset.confirmed_count === dataset.sample_count && !notice && <Alert type="success" showIcon title="全部切图已标注完成，可继续浏览和修改。" />}
      {!record && <div className="empty-state"><h2>{busy ? "正在加载" + taskName + "切图…" : "暂无" + taskName + "切图"}</h2>{!busy && <p>请在关联切图数据集中保存{taskName}框，然后点击「补充导入」。</p>}</div>}
      {record && <>
        <div className="key-record-toolbar"><span>{record.source.songName} · 第 {record.source.pageOrder} 页</span><span className={drafts[record.id] ? "key-unsaved" : "muted"}>{drafts[record.id] ? "未保存" : record.status === "confirmed" ? "已标注" : "待标注"} · {workspace?.position} / {dataset?.sample_count}</span></div>
        <div className="key-image-stage" aria-busy={busy || imageReady !== record.id}>
          {imageError ? <Alert type="error" title={imageError} /> : <>
            {imageReady !== record.id && <span className="key-image-loading">加载图片…</span>}
            <img key={record.id} src={"/api" + base + "/records/" + record.id + "/content"} alt={"待标注的" + taskName + "切图"}
              style={{ width: Math.max(300, record.rectangle.width * 3), visibility: imageReady === record.id ? "visible" : "hidden" }}
              onLoad={() => setImageReady(record.id)} onError={() => setImageError("切图加载失败，请重新打开数据集后重试")} />
          </>}
        </div>
        {timeSignature ? <section className="key-label-panel" aria-label="拍号标注选项">
          <div className="key-label-heading"><h2>选择拍号</h2><span className="muted small">数字 1–9 / 0 快选 · 回车保存 · 左右键浏览</span></div>
          <div className="time-signature-options">{COMMON_TIME_SIGNATURES.map((pair, index) => <Button key={pair.join("/")} type="button" disabled={disabled}
            aria-pressed={label.tonic === pair.join("/")} className={label.tonic === pair.join("/") ? "primary key-tonic" : "key-tonic"}
            onClick={() => select({tonic:pair.join("/"),kind:"play"})}><b>{pair.join(" / ")}</b><kbd>{index === 9 ? 0 : index+1}</kbd></Button>)}</div>
          <div className="key-kind-row"><span>自定义拍号</span>
            <Input aria-label="拍号分子" type="number" min={1} max={32} disabled={disabled} value={label.tonic?.split("/")[0] || ""}
              onChange={(event) => select({tonic:event.target.value+"/"+(label.tonic?.split("/")[1] || ""),kind:"play"})} />
            <span>/</span><Select aria-label="拍号分母" disabled={disabled} value={label.tonic?.split("/")[1] || ""}
              onChange={(event) => select({tonic:(label.tonic?.split("/")[0] || "")+"/"+event.target.value,kind:"play"})}>
              <option value="">选择分母</option>{TIME_DENOMINATORS.map((d) => <option key={d} value={String(d)}>{d}</option>)}
            </Select><span className="spacer" /><strong>{label.tonic || "未选择拍号"}</strong>
          </div>
        </section> : <>
        <section className="key-label-panel" aria-label="调号标注选项">
          <div className="key-label-heading"><h2>选择调号</h2><span className="muted small">数字 1–7 选 C–B · ↓ 降号 · ↑ 升号 · 0 还原</span></div>
          {KEY_ACCIDENTALS.map((suffix) => <div className="key-tonic-row" key={suffix}>
            <span className={accidental === suffix ? "key-row-active" : "muted"}>{suffix === "b" ? "降调 ♭" : suffix === "#" ? "升调 ♯" : "自然音"}</span>
            {KEY_NOTES.map((note, index) => {
              const tonic = note + suffix;
              return <Button key={tonic} type="button" disabled={disabled} aria-pressed={label.tonic === tonic}
                className={label.tonic === tonic ? "primary key-tonic" : "key-tonic"}
                onClick={() => { setAccidental(suffix); select({ ...label, tonic }); }}>
                <b>{prettyTonic(tonic)}</b><kbd>{suffix === "b" ? "↓ " : suffix === "#" ? "↑ " : ""}{index + 1}</kbd>
              </Button>;
            })}
          </div>)}
          <div className="key-kind-row"><span>调号类型</span>
            <Button type="button" disabled={disabled} aria-pressed={label.kind === "original"} className={label.kind === "original" ? "primary" : ""} onClick={() => select({ ...label, kind: "original" })}>原调 <kbd>Q</kbd></Button>
            <Button type="button" disabled={disabled} aria-pressed={label.kind === "play"} className={label.kind === "play" ? "primary" : ""} onClick={() => select({ ...label, kind: "play" })}>选调 <kbd>W</kbd></Button>
            <span className="spacer" /><strong>{label.tonic ? prettyTonic(label.tonic) : "未选调号"} · {label.kind === "original" ? "原调" : label.kind === "play" ? "选调" : "未选类型"}</strong>
          </div>
        </section>
        </>}
        <footer className="key-editor-footer">
          <Button type="button" disabled={busy || !workspace?.previousId} onClick={() => void move("previous")}>← 上一个</Button>
          <Button type="button" disabled={busy || !workspace?.nextId} onClick={() => void move("next")}>下一个 →</Button>
          <span className="muted small">左右键切换{pendingDrafts.length ? ` · ${pendingDrafts.length} 项选择暂存本页` : ""}</span>
          <div className="spacer" />
          <Button type="button" disabled={busy || !dataset || dataset.confirmed_count === dataset.sample_count} onClick={() => void move("pending")}>下一个待标注</Button>
          <Button type="button" className="primary" disabled={disabled || !cropLabelComplete(task, label)} onClick={() => void saveNext()}>{busy ? "处理中…" : "保存并标注下一个 ↵"}</Button>
        </footer>
      </>}
    </div>
  </div>;
}