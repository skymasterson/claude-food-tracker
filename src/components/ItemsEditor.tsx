import { useState } from 'react';
import { parseNum } from '../domain/format';
import { NUTRIENTS, type ItemTemplate } from '../domain/types';
import type { FoodMatch } from '../services/usda';
import { FoodSearch } from './FoodSearch';
import { NutrientCell } from './NutrientCell';
import { ValuesForm } from './ValuesForm';

type Mode = { kind: 'idle' } | { kind: 'search'; index: number | null } | { kind: 'manual'; index: number | null };

function GramsInput({ grams, onChange, name }: { grams: number; onChange: (g: number) => void; name: string }) {
  const [text, setText] = useState(String(grams));
  const [seen, setSeen] = useState(grams);
  if (grams !== seen) {
    setSeen(grams);
    if (parseNum(text) !== grams) setText(String(grams));
  }
  return (
    <label className="grams">
      <span className="sr-only">Amount of {name} in grams</span>
      <input
        inputMode="decimal"
        value={text}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseNum(e.target.value);
          if (n !== null) {
            setSeen(n);
            onChange(n);
          }
        }}
      />
      <span aria-hidden="true">g</span>
    </label>
  );
}

export function ItemsEditor({ items, onChange, usdaKey, addLabel = 'Add a food' }: {
  items: ItemTemplate[];
  onChange: (items: ItemTemplate[]) => void;
  usdaKey: string;
  addLabel?: string;
}) {
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const replace = (i: number, item: ItemTemplate) => onChange(items.map((x, idx) => (idx === i ? item : x)));

  function pick(m: FoodMatch, index: number | null) {
    if (index === null) {
      onChange([...items, { name: m.description, grams: 100, per100g: m.per100g, fdcId: m.fdcId, usdaDescription: m.description }]);
    } else {
      // Swapping the matched food replaces every value with the database's; missing ones become unknown.
      replace(index, { ...items[index], per100g: m.per100g, fdcId: m.fdcId, usdaDescription: m.description });
    }
    setMode({ kind: 'idle' });
  }

  return (
    <div className="items">
      {items.length === 0 && mode.kind === 'idle' && <p className="muted">No foods yet. Add one below.</p>}
      {items.map((item, i) => (
        <div className="item" key={i}>
          <div className="item-top">
            <GramsInput grams={item.grams} name={item.name} onChange={(g) => replace(i, { ...item, grams: g })} />
            <div className="item-name">
              <strong>{item.name}</strong>
              <span className="muted small">
                {[item.household, item.confidence ? `${item.confidence} confidence` : '', item.usdaDescription ? `USDA: ${item.usdaDescription}` : 'no database match']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
          </div>
          <div className="ncells">
            {NUTRIENTS.map((k) => <NutrientCell key={k} item={item} nutrient={k} />)}
          </div>
          {mode.kind === 'search' && mode.index === i ? (
            <FoodSearch initialQuery={item.name} usdaKey={usdaKey} onPick={(m) => pick(m, i)} onCancel={() => setMode({ kind: 'idle' })} />
          ) : mode.kind === 'manual' && mode.index === i ? (
            <ValuesForm initial={item} onCancel={() => setMode({ kind: 'idle' })} onSave={(it) => { replace(i, it); setMode({ kind: 'idle' }); }} />
          ) : (
            <div className="item-actions">
              <button className="btn small" onClick={() => setMode({ kind: 'search', index: i })}>Swap food</button>
              <button className="btn small" onClick={() => setMode({ kind: 'manual', index: i })}>Edit values</button>
              <button className="btn small danger" onClick={() => onChange(items.filter((_, idx) => idx !== i))} aria-label={`Delete ${item.name}`}>Delete</button>
            </div>
          )}
        </div>
      ))}
      {mode.kind === 'search' && mode.index === null && (
        <FoodSearch initialQuery="" usdaKey={usdaKey} onPick={(m) => pick(m, null)} onCancel={() => setMode({ kind: 'idle' })} />
      )}
      {mode.kind === 'manual' && mode.index === null && (
        <ValuesForm onCancel={() => setMode({ kind: 'idle' })} onSave={(it) => { onChange([...items, it]); setMode({ kind: 'idle' }); }} />
      )}
      {mode.kind === 'idle' && (
        <div className="row add-row">
          <button className="btn" onClick={() => setMode({ kind: 'search', index: null })}>＋ {addLabel} (search)</button>
          <button className="btn" onClick={() => setMode({ kind: 'manual', index: null })}>＋ Enter values by hand</button>
        </div>
      )}
    </div>
  );
}
