import { fmtValue, SOURCE_LABEL, SOURCE_SHORT } from '../domain/format';
import { itemAmount } from '../domain/nutrients';
import { NUTRIENT_META, type ItemTemplate, type NutrientKey } from '../domain/types';

/** One nutrient amount for an item's portion, always shown with where the number came from. */
export function NutrientCell({ item, nutrient }: { item: ItemTemplate; nutrient: NutrientKey }) {
  const amount = itemAmount(item, nutrient);
  const source = amount === null ? null : item.per100g[nutrient].source;
  const meta = NUTRIENT_META[nutrient];
  const cls = source === null ? 'src-unknown' : `src-${source}`;
  const label = `${meta.label}: ${amount === null ? 'unknown' : fmtValue(amount, nutrient)}${source ? `, ${SOURCE_LABEL[source]}` : ''}`;
  return (
    <div className={`ncell ${cls}`} aria-label={label}>
      <span className="ncell-name" aria-hidden="true">{meta.short} <small>{meta.unit}</small></span>
      <span className="ncell-val" aria-hidden="true">
        {source === 'ai-estimate' ? '~' : ''}
        {fmtValue(amount, nutrient, false)}
      </span>
      <span className="ncell-src" aria-hidden="true">{source ? SOURCE_SHORT[source] : 'unknown'}</span>
    </div>
  );
}
