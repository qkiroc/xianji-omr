"use client";
import { Card, Empty, Segmented, Spin, Tooltip } from "antd";
import { useEffect, useRef, useState } from "react";
import type { ReviewTrend } from "../../shared/review-trend";

export function ReviewTrendChart({ trend, days, loading, onDaysChange }: {
  trend: ReviewTrend | null; days: number; loading: boolean; onDaysChange: (days: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const measure = () => setWidth(Math.max(240, Math.floor(node.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const points = trend?.points || [];
  const peak = Math.max(1, ...points.map((p) => p.count));
  const step = Math.max(1, Math.ceil(peak / 4)), ceiling = step * 4;
  const left = 36, top = 16, bottom = 184, right = width - 12;
  const slot = (right - left) / Math.max(points.length, 1);
  const ticks = new Set(Array.from({ length: width < 600 ? 3 : 7 }, (_, i) =>
    Math.round(i * (points.length - 1) / (width < 600 ? 2 : 6))));
  const available = !!trend && !loading;
  return (
    <Card className="review-trend" size="small" title={
      <div className="review-trend-title"><strong>人工审核趋势</strong><span>每日确认谱页数 · 北京时间</span></div>
    } extra={
      <Segmented aria-label="审核趋势范围" size="small" value={days}
        options={[7, 30, 90].map((value) => ({ label: "近 " + value + " 天", value }))}
        onChange={(value) => onDaysChange(Number(value))} />
    }>
      <div className="review-trend-metrics">
        <div><span>本期审核</span><strong>{available ? trend.total : "—"}<small>页次</small></strong></div>
        <div><span>今日审核</span><strong>{available ? points.at(-1)?.count || 0 : "—"}<small>页</small></strong></div>
        <div><span>日均审核</span><strong>{available ? (trend.total / days).toFixed(1) : "—"}<small>页</small></strong></div>
      </div>
      <div className="review-trend-plot" ref={host} aria-busy={loading}>
        <Spin spinning={loading}>
          <svg viewBox={`0 0 ${width} 216`} role="group" aria-label="每日人工审核谱页数量"
            className="review-trend-svg">
            {[0, 1, 2, 3, 4].map((i) => {
              const value = i * step, y = bottom - value / ceiling * (bottom - top);
              return <g key={i}>
                <line x1={left} x2={right} y1={y} y2={y} className="review-trend-grid" />
                <text x={left - 10} y={y + 4} textAnchor="end">{value}</text>
              </g>;
            })}
            {points.map((point, i) => {
              const x = left + i * slot, barWidth = Math.max(1, Math.min(24, slot * 0.62));
              const height = point.count / ceiling * (bottom - top);
              const label = point.date + " · 人工审核 " + point.count + " 页" +
                (point.estimated ? "（含 " + point.estimated + " 页历史估算）" : "");
              return <g key={point.date}>
                <Tooltip title={label} trigger={["hover", "focus"]}>
                  <g data-review-date={point.date} data-count={point.count}
                    tabIndex={point.count ? 0 : -1} role="img" aria-label={label} className="review-trend-point">
                    <rect x={x} y={top} width={slot} height={bottom - top} fill="transparent" />
                    <rect x={x + (slot - barWidth) / 2} y={bottom - height}
                      width={barWidth} height={height} rx={Math.min(3, barWidth / 2)} className="review-trend-bar" />
                  </g>
                </Tooltip>
                {ticks.has(i) && <text x={x + slot / 2} y={bottom + 22}
                  textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
                  {point.date.slice(5).replace("-", "/")}
                </text>}
              </g>;
            })}
          </svg>
        </Spin>
        {!loading && trend?.total === 0 && <div className="review-trend-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这段时间还没有人工审核记录" />
        </div>}
      </div>
      <div className="review-trend-note">
        <span>同页同日只计一次，AI 复核和合成批量确认不计入。数量随搜索与集合筛选更新。</span>
        {!!trend?.estimated && <span>含 {trend.estimated} 页次历史估算，按已有确认页的更新时间回填。</span>}
      </div>
    </Card>
  );
}
