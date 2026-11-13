import { useState } from 'react';
import { fmtNumber, parseNum } from '../domain/format';
import { itemAmount, per100FromPortion } from '../domain/nutrients';
import { NUTRIENTS, NUTRIENT_META, type ItemTemplate, type NutrientKey, type Nutrients } from '../domain/types';

/**
 * Type a food and its values for the amount eaten (e.g. from a menu's nutrition sheet).
 * Blank fields are stored as unknown, not zero. Only fields the user changes become "entered by you".
 */
export function ValuesForm({ initial, onSave, onCancel }: {
  initial?: ItemTemplate;
  onSave: (item: ItemTemplate) => void;
  onCancel: () => void;
}) {
  const start = (k: NutrientKey) => {
    if (!initial) return '';
    const a = itemAmount(initial, k);
    return a === null ? '' : fmtNumber(a, k).replace(/,/g, '');
  };
  const [name, setName] = useState(initial?.name ?? '');
  const [grams, setGrams] = useState(initial ? String(initial.grams) : '');
  const [household, setHousehold] = useState(initial?.household ?? '');
  const [vals, setVals] = useState<Record<NutrientKey, string>>(() => {
    const o = {} as Record<NutrientKey, string>;
    for (const k of NUTRIENTS) o[k] = start(k);
    return o;
  });
  const [error, setError] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Give the food a name.');
    // Without a weight, values are stored against a nominal 100 g portion.
    const g = parseNum(grams) ?? 100;
    if (!(g > 0)) return setError('Amount must be more than 0 g.');
    for (const k of NUTRIENTS) {
      if (vals[k].trim() !== '' && parseNum(vals[k]) === null) return setError(`${NUTRIENT_META[k].label} must be a number, or left blank if unknown.`);
    }
    const prot = parseNum(vals.protein);
    const anim = parseNum(vals.animalProtein);
    if (prot !== null && anim !== null && anim > prot + 0.05) return setError('Animal protein cannot be more than total protein.');
    const per100g = {} as Nutrients;
    for (const k of NUTRIENTS) {
      const unchanged = initial && vals[k] === start(k) && String(g) === String(initial.grams);
      per100g[k] = unchanged ? initial.per100g[k] : per100FromPortion(parseNum(vals[k]), g, 'user-entered');
    }
    onSave({
      ...(initial ?? {}),
      name: name.trim(),
      grams: g,
      household: household.trim() || (parseNum(grams) === null ? '1 serving' : undefined),
      per100g,
    });
  }

  return (
    <form className="panel values-form" onSubmit={submit}>
      <label>
        Food name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pad thai, restaurant" />
      </label>
      <div className="row">
        <label>
          Amount (g)
          <input inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} placeholder="optional" />
        </label>
        <label>
          Described as
          <input value={household} onChange={(e) => setHousehold(e.target.value)} placeholder="e.g. 1 bowl" />
        </label>
      </div>
      <p className="muted small">Values for the amount eaten. Leave a field blank if you don't know it — it is recorded as unknown, not as zero. Animal protein is the part of the protein from meat, poultry, fish, eggs and dairy.</p>
      <div className="grid5">
        {NUTRIENTS.map((k) => (
          <label key={k}>
            {NUTRIENT_META[k].label} ({NUTRIENT_META[k].unit})
            <input inputMode="decimal" value={vals[k]} placeholder="?" onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      {error && <p className="notice warn" role="alert">{error}</p>}
      <div className="row">
        <button className="btn primary" type="submit">{initial ? 'Update item' : 'Add item'}</button>
        <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
