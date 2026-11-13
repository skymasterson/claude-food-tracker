import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ItemsEditor } from '../components/ItemsEditor';
import { db } from '../db/db';
import { saveRecipe } from '../db/repo';
import { fmtTotal, parseNum } from '../domain/format';
import { scaleItems, sumAll } from '../domain/nutrients';
import { NUTRIENTS, NUTRIENT_META, type ItemTemplate } from '../domain/types';
import { useSettings } from '../store';

export function RecipeEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const settings = useSettings();
  const [name, setName] = useState('');
  const [servings, setServings] = useState('4');
  const [items, setItems] = useState<ItemTemplate[]>([]);
  const [createdAt, setCreatedAt] = useState(Date.now());
  const [ready, setReady] = useState(isNew);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isNew) return;
    void db.recipes.get(Number(id)).then((r) => {
      if (!r) return nav('/saved', { replace: true });
      setName(r.name);
      setServings(String(r.servings));
      setItems(r.ingredients);
      setCreatedAt(r.createdAt);
      setReady(true);
    });
  }, [id, isNew, nav]);

  if (!settings || !ready) return <p className="muted">Loading…</p>;
  const n = parseNum(servings);
  const per = sumAll(scaleItems(items, 1 / (n && n > 0 ? n : 1)));

  async function save() {
    if (!name.trim()) return setError('Give the recipe a name.');
    if (!n || n <= 0) return setError('Servings must be a number above 0.');
    if (items.length === 0) return setError('Add at least one ingredient.');
    await saveRecipe({ ...(isNew ? {} : { id: Number(id) }), name: name.trim(), servings: n, ingredients: items, createdAt });
    nav('/saved');
  }

  return (
    <>
      <h1>{isNew ? 'New recipe' : 'Edit recipe'}</h1>
      <section className="card">
        <label>
          Recipe name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chicken and rice soup" />
        </label>
        <label>
          Servings the whole recipe makes
          <input inputMode="decimal" value={servings} onChange={(e) => setServings(e.target.value)} />
        </label>
      </section>
      <h2>Ingredients <span className="muted small">— amounts for the whole recipe</span></h2>
      <ItemsEditor items={items} onChange={setItems} settings={settings} addLabel="Add an ingredient" />
      <section className="card">
        <h2>Per serving</h2>
        <dl className="meal-totals">
          {NUTRIENTS.map((k) => (
            <div key={k}>
              <dt>{NUTRIENT_META[k].label}</dt>
              <dd>{fmtTotal(per[k], k)}</dd>
            </div>
          ))}
        </dl>
      </section>
      {error && <p className="notice warn" role="alert">{error}</p>}
      <div className="sticky-actions">
        <button className="btn primary big" onClick={save}>Save recipe</button>
      </div>
      <div className="row">
          {!isNew && (
            <button className="btn danger" onClick={async () => { if (confirm('Delete this recipe?')) { await db.recipes.delete(Number(id)); nav('/saved'); } }}>
              Delete recipe
            </button>
          )}
          <button className="btn ghost" onClick={() => nav('/saved')}>Cancel</button>
      </div>
    </>
  );
}
