import { useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteAllData, setSetting, type Settings as S } from '../db/repo';
import { parseNum } from '../domain/format';
import { NUTRIENTS, NUTRIENT_META, type NutrientKey, type Target, type TargetType } from '../domain/types';
import { MODELS } from '../services/ai/models';
import { relayConfigured, testRelay } from '../services/fatsecret';
import { useSettings } from '../store';

export const DISCLAIMER =
  'Values in this app are estimates from photos, a food database and AI. It is a logging aid, not medical advice. Follow the targets and guidance your care team gives you.';

function TargetRow({ nutrient, target, onChange }: { nutrient: NutrientKey; target: Target; onChange: (t: Target) => void }) {
  const meta = NUTRIENT_META[nutrient];
  const [value, setValue] = useState(target.value ? String(target.value) : '');
  const [max, setMax] = useState(target.max ? String(target.max) : '');
  const commit = (type: TargetType, v: string, m: string) => {
    const n = parseNum(v) ?? 0;
    const hi = parseNum(m);
    onChange({ type, value: n, ...(type === 'range' && hi !== null ? { max: hi } : {}) });
  };
  const bad = target.type !== 'none' && (!(target.value > 0) || (target.type === 'range' && !((target.max ?? 0) > target.value)));
  return (
    <fieldset className="target-row">
      <legend>{meta.label} ({meta.unit})</legend>
      <div className="row">
        <label>
          Type
          <select value={target.type} onChange={(e) => commit(e.target.value as TargetType, value, max)}>
            <option value="none">No target</option>
            <option value="maximum">Maximum</option>
            <option value="minimum">Minimum</option>
            <option value="range">Range</option>
          </select>
        </label>
        {target.type !== 'none' && (
          <label>
            {target.type === 'range' ? 'From' : 'Amount'}
            <input inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); commit(target.type, e.target.value, max); }} />
          </label>
        )}
        {target.type === 'range' && (
          <label>
            To
            <input inputMode="decimal" value={max} onChange={(e) => { setMax(e.target.value); commit(target.type, value, e.target.value); }} />
          </label>
        )}
      </div>
      {bad && <p className="notice warn small">{target.type === 'range' ? 'Enter a “from” above 0 and a larger “to”.' : 'Enter an amount above 0.'} Until then this nutrient is tracked without a target.</p>}
    </fieldset>
  );
}

function KeyField({ label, value, onSave, help, plain }: { label: string; value: string; onSave: (v: string) => void; help: React.ReactNode; plain?: boolean }) {
  const [text, setText] = useState(value);
  const [show, setShow] = useState(Boolean(plain));
  return (
    <label>
      {label}
      <span className="row">
        <input type={show ? 'text' : 'password'} value={text} autoComplete="off" spellCheck={false} placeholder="not set"
          onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() !== value && onSave(text.trim())} />
        {!plain && <button type="button" className="btn small" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>}
      </span>
      <span className="muted small">{help} {value ? '✓ Saved on this device.' : ''}</span>
    </label>
  );
}

export function Settings() {
  const settings = useSettings();
  const [confirmText, setConfirmText] = useState('');
  const [relayTest, setRelayTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  if (!settings) return <p className="muted">Loading…</p>;
  const set = <K extends keyof S>(k: K, v: S[K]) => void setSetting(k, v);

  return (
    <>
      <h1>Settings</h1>
      <p className="notice">{DISCLAIMER}</p>

      <section className="card">
        <h2>Daily targets</h2>
        <p className="muted small">Change these only as your care team advises. Animal protein is the protein from meat, poultry, fish, eggs and dairy; total protein also includes plant protein.</p>
        {NUTRIENTS.map((k) => (
          <TargetRow key={k} nutrient={k} target={settings.targets[k]} onChange={(t) => set('targets', { ...settings.targets, [k]: t })} />
        ))}
      </section>

      <section className="card">
        <h2>API keys</h2>
        <KeyField label="Anthropic API key (photo and text analysis)" value={settings.anthropicKey} onSave={(v) => set('anthropicKey', v)}
          help="From console.anthropic.com → API keys. Starts with sk-ant-." />
        <KeyField label="USDA FoodData Central API key (nutrient database)" value={settings.usdaKey} onSave={(v) => set('usdaKey', v)}
          help="Free from fdc.nal.usda.gov/api-key-signup." />
        <label>
          AI model
          <select value={settings.aiModel} onChange={(e) => set('aiModel', e.target.value)}>
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <p className="muted small">
          Keys are stored only on this phone and sent only to Anthropic, USDA and (if set up) your own FatSecret relay. Photos you analyse are sent to Anthropic. Keys are not included in backups.
        </p>
      </section>

      <section className="card">
        <h2>FatSecret (optional)</h2>
        <p className="muted small">
          Adds branded, packaged and chain-restaurant foods. FatSecret has no phosphorus values, and it needs your own relay
          (a free Cloudflare Worker) — see the setup guide in the project's <code>docs/fatsecret-relay.md</code>.
        </p>
        <KeyField label="Relay address" value={settings.fatsecretUrl} onSave={(v) => set('fatsecretUrl', v)} plain
          help="Looks like https://something.workers.dev" />
        <KeyField label="Relay passphrase" value={settings.fatsecretToken} onSave={(v) => set('fatsecretToken', v)}
          help="The RELAY_TOKEN you set on the relay." />
        <button className="btn" disabled={!relayConfigured(settings) || testing}
          onClick={async () => {
            setTesting(true);
            setRelayTest(null);
            try {
              setRelayTest({ ok: true, text: await testRelay(settings) });
            } catch (e) {
              setRelayTest({ ok: false, text: e instanceof Error ? e.message : 'Test failed.' });
            } finally {
              setTesting(false);
            }
          }}>
          {testing ? 'Testing…' : 'Test FatSecret connection'}
        </button>
        {relayTest && <p className={`notice${relayTest.ok ? '' : ' warn'}`} role="status" data-testid="relay-test">{relayTest.text}</p>}
        <p className="muted small"><a href="https://www.fatsecret.com" target="_blank" rel="noreferrer">Powered by fatsecret</a></p>
      </section>

      <section className="card">
        <h2>Backup and restore</h2>
        <Link className="btn" to="/export">Open export &amp; backup</Link>
      </section>

      <section className="card">
        <h2>Delete all data</h2>
        <p className="muted small">Removes every meal, favourite, recipe, target and API key from this phone. This cannot be undone. Type DELETE to confirm.</p>
        <div className="row">
          <input aria-label="Type DELETE to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
          <button className="btn danger" disabled={confirmText !== 'DELETE'} onClick={async () => { await deleteAllData(); setConfirmText(''); }}>Delete everything</button>
        </div>
      </section>
    </>
  );
}
