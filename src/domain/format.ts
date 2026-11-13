import type { Total } from './nutrients';
import type { Status } from './targets';
import { NUTRIENT_META, type NutrientKey, type Source, type Target } from './types';

export function fmtNumber(value: number, key: NutrientKey): string {
  const digits = (key === 'protein' || key === 'animalProtein') && Math.abs(value) < 100 ? 1 : 0;
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function fmtValue(value: number | null, key: NutrientKey, withUnit = true): string {
  if (value === null || !Number.isFinite(value)) return '?';
  return withUnit ? `${fmtNumber(value, key)} ${NUTRIENT_META[key].unit}` : fmtNumber(value, key);
}

/** "1,240 mg", "at least 1,240 mg" when some values are unknown, "?" when nothing is known. */
export function fmtTotal(total: Total, key: NutrientKey): string {
  if (total.knownCount === 0 && total.hasUnknown) return '?';
  const base = fmtValue(total.total, key);
  return total.hasUnknown ? `at least ${base}` : base;
}

export function fmtTarget(target: Target, key: NutrientKey): string {
  const u = NUTRIENT_META[key].unit;
  switch (target.type) {
    case 'none':
      return 'no target';
    case 'maximum':
      return `max ${fmtNumber(target.value, key)} ${u}`;
    case 'minimum':
      return `min ${fmtNumber(target.value, key)} ${u}`;
    case 'range':
      return `${fmtNumber(target.value, key)}–${fmtNumber(target.max ?? target.value, key)} ${u}`;
  }
}

export function statusText(status: Status, key: NutrientKey): string {
  const amt = (n: number) => fmtValue(Math.abs(n), key);
  const tail = status.uncertain ? ' — some values unknown, real total may be higher' : '';
  switch (status.state) {
    case 'none':
      return status.uncertain ? 'Some values unknown' : '';
    case 'over':
      return `Over by ${amt(status.remaining ?? 0)}${status.uncertain ? ' or more' : ''}`;
    case 'approaching':
      return `Near limit: ${amt(status.remaining ?? 0)} left${tail}`;
    case 'ok':
      return `${amt(status.remaining ?? 0)} left${tail}`;
    case 'under':
      return `${amt(status.remaining ?? 0)} to go${status.uncertain ? ' (some values unknown)' : ''}`;
    case 'met':
      return 'Minimum reached';
  }
}

export const SOURCE_LABEL: Record<Source, string> = {
  usda: 'USDA',
  'ai-estimate': 'AI estimate',
  'user-entered': 'Entered by you',
};
export const SOURCE_SHORT: Record<Source, string> = { usda: 'USDA', 'ai-estimate': 'AI est.', 'user-entered': 'You' };

export function parseNum(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
