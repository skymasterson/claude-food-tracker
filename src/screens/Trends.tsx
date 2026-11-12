import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getRange } from '../db/repo';
import { dailyRows, type DayRow } from '../domain/csv';
import { addDays, dayKey, prettyDay, rangeDays, shortDay } from '../domain/dates';
import { fmtTarget, fmtTotal, fmtValue } from '../domain/format';
import { isOver, targetLine } from '../domain/targets';
import { NUTRIENTS, NUTRIENT_META, type NutrientKey, type Target } from '../domain/types';
import { useSettings } from '../store';

interface Point {
  day: string;
  label: string;
  value: number;
  over: boolean;
  incomplete: boolean;
  logged: boolean;
  text: string;
  mark: string;
}

function points(rows: DayRow[], key: NutrientKey, target: Target): Point[] {
  return rows.map((r) => {
    const t = r.totals[key];
    const over = isOver(t, target);
    return {
      day: r.day,
      label: shortDay(r.day),
      value: Math.round(t.total * 10) / 10,
      over,
      incomplete: t.hasUnknown,
      logged: r.entries > 0,
      text: r.entries > 0 ? fmtTotal(t, key) : 'nothing logged',
      mark: over ? '✕' : t.hasUnknown ? '+' : '',
    };
  });
}

function Tip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tip">
      <strong>{prettyDay(p.day)}</strong>
      <span>{p.text}</span>
      {p.over && <span>✕ Over the limit</span>}
      {p.incomplete && <span>+ Some values unknown</span>}
    </div>
  );
}

function NutrientTrend({ nutrient, rows, target }: { nutrient: NutrientKey; rows: DayRow[]; target: Target }) {
  const data = points(rows, nutrient, target);
  const logged = data.filter((p) => p.logged);
  const avg = logged.length ? logged.reduce((s, p) => s + p.value, 0) / logged.length : null;
  const overDays = logged.filter((p) => p.over).length;
  const incompleteDays = logged.filter((p) => p.incomplete).length;
  const line = targetLine(target);
  const meta = NUTRIENT_META[nutrient];
  const hasLimit = target.type === 'maximum' || target.type === 'range';

  return (
    <section className="card trend" data-nutrient={nutrient}>
      <h2>{meta.label} <span className="muted small">{meta.unit} per day · {fmtTarget(target, nutrient)}</span></h2>
      <div className="stats">
        <div>
          <span className="stat-num">{avg === null ? '—' : `${incompleteDays ? '≥ ' : ''}${fmtValue(avg, nutrient)}`}</span>
          <span className="muted small">daily average ({logged.length} day{logged.length === 1 ? '' : 's'} logged)</span>
        </div>
        {hasLimit && (
          <div>
            <span className="stat-num">{overDays === 0 ? '0' : `✕ ${overDays}`}</span>
            <span className="muted small">day{overDays === 1 ? '' : 's'} over the limit</span>
          </div>
        )}
      </div>
      <div className="chart" role="img" aria-label={`${meta.label} per day. ${logged.length} days logged${hasLimit ? `, ${overDays} over the limit` : ''}.`}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--grid)' }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis width={44} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, (max: number) => Math.ceil(Math.max(max, line ?? 0) * 1.1) || 1]} />
            <Tooltip content={<Tip />} cursor={{ fill: 'var(--hover)' }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={28}>
              {data.map((p) => <Cell key={p.day} fill={p.over ? 'var(--over)' : 'var(--bar)'} />)}
              {data.length <= 14 && <LabelList dataKey="mark" position="top" fill="var(--text)" fontSize={12} />}
            </Bar>
            {line !== null && (
              <ReferenceLine y={line} stroke="var(--text)" strokeDasharray="5 4" strokeWidth={1.5}
                label={{ value: target.type === 'minimum' ? 'min' : 'limit', position: 'insideTopRight', fill: 'var(--text)', fontSize: 11 }} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {incompleteDays > 0 && <p className="muted small">+ {incompleteDays} day{incompleteDays === 1 ? ' has' : 's have'} unknown values; those totals and the average are lower bounds.</p>}
      <details>
        <summary>Show as table</summary>
        <table className="table">
          <thead><tr><th>Day</th><th>{meta.label}</th><th>Status</th></tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.day}>
                <td>{p.label}</td>
                <td>{p.text}</td>
                <td>{!p.logged ? '' : p.over ? '✕ over' : hasLimit ? 'within limit' + (p.incomplete ? ' (incomplete)' : '') : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

export function Trends() {
  const settings = useSettings();
  const [span, setSpan] = useState<7 | 30>(7);
  const to = dayKey();
  const from = addDays(to, -(span - 1));
  const data = useLiveQuery(() => getRange(from, to), [from, to]);
  if (!settings || !data) return <p className="muted">Loading…</p>;
  const rows = dailyRows(rangeDays(from, to), data.items, data.entries);

  return (
    <>
      <h1>Trends</h1>
      <div className="segmented" role="group" aria-label="Time range">
        {([7, 30] as const).map((n) => (
          <button key={n} className={span === n ? 'on' : ''} aria-pressed={span === n} onClick={() => setSpan(n)}>Last {n} days</button>
        ))}
      </div>
      {data.entries.length === 0 && <p className="muted">Nothing logged in this period yet.</p>}
      {NUTRIENTS.map((k) => <NutrientTrend key={k} nutrient={k} rows={rows} target={settings.targets[k]} />)}
    </>
  );
}
