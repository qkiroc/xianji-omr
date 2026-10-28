"use client";
import { Select } from "../ui/antd";
import { ANNOTATION_TREND_DAYS, type AnnotationTrend } from "../../shared/annotation-trend";
export function KeyDailyChart({ trend, onDaysChange, name = "调号" }: { name?: string; trend: AnnotationTrend; onDaysChange: (days: number) => void }) {
  const max = Math.max(1, ...trend.points.map((p) => p.count));
  const left = 42, bottom = 180, width = 900, step = width / trend.points.length;
  return <section className="key-daily-chart" aria-label={"每日" + name + "标注量"}>
    <div className="key-daily-chart-heading"><div><h2>每日标注量</h2><p className="muted small">北京时间 · 每张切图首次标注计一次 · 整个数据集统计</p></div>
      <div className="actions"><span>今日 <b>{trend.today}</b> 张</span><span>期间共 <b>{trend.total}</b> 张</span>
        <Select aria-label="标注图表时间范围" value={String(trend.days)} onChange={(event) => onDaysChange(Number(event.target.value))}>
          {ANNOTATION_TREND_DAYS.map((days) => <option key={days} value={days}>最近 {days} 天</option>)}
        </Select>
      </div>
    </div>
    <svg viewBox="0 0 960 220" role="img" aria-label={`最近 ${trend.days} 天共标注 ${trend.total} 张，今日 ${trend.today} 张`}>
      {[0, 0.5, 1].map((ratio) => <g key={ratio}><line x1={left} y1={bottom-ratio*140} x2={left+width} y2={bottom-ratio*140} stroke="var(--line)" />
        <text x={left-8} y={bottom-ratio*140+4} textAnchor="end" fontSize="11" fill="var(--muted)">{Number((max*ratio).toFixed(1))}</text></g>)}
      {trend.points.map((p, i) => <g key={p.date}>
        <rect x={left+i*step+step*0.18} y={bottom-p.count/max*140} width={step*0.64} height={p.count/max*140} rx="2" fill={i === trend.points.length-1 ? "#234fc1" : "#6792ed"}>
          <title>{p.date}：{p.count} 张{p.estimated ? `（${p.estimated} 张历史时间估计）` : ""}</title>
        </rect>
        {(i % Math.ceil(trend.days/6) === 0 || i === trend.days-1) && <text x={left+(i+0.5)*step} y="205" textAnchor="middle" fontSize="11" fill="var(--muted)">{p.date.slice(5)}</text>}
      </g>)}
      {!trend.total && <text x="490" y="100" textAnchor="middle" fontSize="14" fill="var(--muted)">这段时间暂无标注，保存标注后会在这里显示</text>}
    </svg>
    {trend.estimated > 0 && <p className="muted small">其中 {trend.estimated} 张历史标注缺少首次保存时间，按迁移前的最后保存日期估计。</p>}
  </section>;
}