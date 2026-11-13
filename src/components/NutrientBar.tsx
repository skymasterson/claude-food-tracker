import { fmtTarget, fmtTotal, statusText } from '../domain/format';
import type { Total } from '../domain/nutrients';
import { targetStatus, type StatusState } from '../domain/targets';
import { NUTRIENT_META, type NutrientKey, type Target } from '../domain/types';

const ICON: Record<StatusState, string> = { none: '', ok: '✓', approaching: '▲', over: '✕', under: '…', met: '✓' };
const WORD: Record<StatusState, string> = { none: '', ok: 'OK', approaching: 'Near limit', over: 'Over', under: 'Below', met: 'Reached' };

export function NutrientBar({ nutrient, total, target, compact }: { nutrient: NutrientKey; total: Total; target: Target; compact?: boolean }) {
  const status = targetStatus(total, target);
  const pct = status.fraction === null ? 0 : Math.round(status.fraction * 100);
  // With unknown values the total is only a lower bound, so "under the limit" is not confirmed: say so instead of "OK".
  const incomplete = status.uncertain && status.state === 'ok';
  const text = statusText(status, nutrient);
  return (
    <div className={`nbar state-${incomplete ? 'incomplete' : status.state}${compact ? ' compact' : ''}`} data-nutrient={nutrient}>
      <div className="nbar-head">
        <span className="nbar-label">{NUTRIENT_META[nutrient].label}</span>
        {status.state !== 'none' && (
          <span className="nbar-state">
            <span aria-hidden="true">{incomplete ? '?' : ICON[status.state]}</span> {incomplete ? 'Incomplete' : WORD[status.state]}
          </span>
        )}
      </div>
      <div className="nbar-nums">
        <strong className="nbar-total">{fmtTotal(total, nutrient)}</strong>
        <span className="nbar-target">{fmtTarget(target, nutrient)}</span>
      </div>
      {status.fraction !== null && (
        <div
          className="nbar-track"
          role="progressbar"
          aria-label={`${NUTRIENT_META[nutrient].label}: ${fmtTotal(total, nutrient)}, ${fmtTarget(target, nutrient)}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className={`nbar-fill${total.hasUnknown ? ' open-ended' : ''}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {text && <div className="nbar-text">{text}</div>}
    </div>
  );
}
