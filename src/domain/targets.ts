import type { Total } from './nutrients';
import type { Target } from './types';

export type StatusState = 'none' | 'ok' | 'approaching' | 'over' | 'under' | 'met';

export interface Status {
  state: StatusState;
  /** 0..1 fill for a progress bar (capped), or null with no target. */
  fraction: number | null;
  /** Amount left before a maximum / still needed for a minimum. Null when not applicable. */
  remaining: number | null;
  /** True when the total is only a lower bound, so a non-"over" state is not a confirmed pass. */
  uncertain: boolean;
}

export const APPROACHING_AT = 0.8;

export function targetStatus(total: Total, target: Target): Status {
  const t = total.total;
  const uncertain = total.hasUnknown;
  const cap = (n: number) => Math.max(0, Math.min(1, n));

  if (target.type === 'none' || !(target.value > 0)) {
    return { state: 'none', fraction: null, remaining: null, uncertain };
  }
  if (target.type === 'maximum') {
    const state: StatusState = t > target.value ? 'over' : t >= target.value * APPROACHING_AT ? 'approaching' : 'ok';
    return { state, fraction: cap(t / target.value), remaining: target.value - t, uncertain };
  }
  if (target.type === 'minimum') {
    const met = t >= target.value;
    return { state: met ? 'met' : 'under', fraction: cap(t / target.value), remaining: met ? 0 : target.value - t, uncertain };
  }
  // range
  const hi = target.max && target.max > target.value ? target.max : target.value;
  if (t > hi) return { state: 'over', fraction: 1, remaining: hi - t, uncertain };
  if (t < target.value) return { state: 'under', fraction: cap(t / hi), remaining: target.value - t, uncertain };
  return { state: 'ok', fraction: cap(t / hi), remaining: hi - t, uncertain };
}

/** The number a chart should draw as the limit line. */
export function targetLine(target: Target): number | null {
  if (target.type === 'none' || !(target.value > 0)) return null;
  if (target.type === 'range') return target.max && target.max > target.value ? target.max : target.value;
  return target.value;
}

/** Whether a day counts as "over the limit" (only meaningful for maximum / range). */
export function isOver(total: Total, target: Target): boolean {
  return targetStatus(total, target).state === 'over';
}
