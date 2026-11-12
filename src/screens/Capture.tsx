import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../db/db';
import { analyzeMeal } from '../services/analyze';
import { base64Of, makeThumbnail, resizeForAnalysis } from '../services/image';
import { setDraft, useDay, useSettings } from '../store';
import { newEntry } from '../util';

export function Capture({ mode }: { mode: 'photo' | 'text' }) {
  const settings = useSettings();
  const { day } = useDay();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const showDrafts = params.get('drafts') === '1';
  const drafts = useLiveQuery(() => db.drafts.orderBy('createdAt').toArray(), []);

  const [image, setImage] = useState<Blob | null>(null);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [preview, setPreview] = useState('');
  const [note, setNote] = useState('');
  const [isRestaurant, setIsRestaurant] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    if (!image) return setPreview('');
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  if (!settings) return <p className="muted">Loading…</p>;

  function chosen(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      setImage(f);
      setDraftId(null);
      setError('');
    }
    e.target.value = '';
  }

  async function saveForLater() {
    if (!image) return;
    const { blob } = await resizeForAnalysis(image);
    if (draftId !== null) await db.drafts.update(draftId, { note, isRestaurant });
    else await db.drafts.add({ createdAt: Date.now(), image: blob, note, isRestaurant });
    nav('/');
  }

  async function analyse() {
    if (!settings) return;
    if (mode === 'photo' && !image) return setError('Take or choose a photo first.');
    if (mode === 'text' && !note.trim()) return setError('Describe what you ate first.');
    setBusy(true);
    setError('');
    try {
      let imageBase64: string | undefined;
      let thumbnail: string | undefined;
      if (image) {
        const resized = await resizeForAnalysis(image);
        imageBase64 = base64Of(resized.dataUrl);
        thumbnail = await makeThumbnail(resized.blob);
      }
      const result = await analyzeMeal({ imageBase64, note }, settings);
      if (draftId !== null) await db.drafts.delete(draftId);
      setDraft({
        entry: newEntry(day, mode, { note: note.trim() || undefined, isRestaurant, thumbnail }),
        items: result.items,
        warnings: result.warnings,
      });
      nav('/review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed.');
    } finally {
      setBusy(false);
    }
  }

  const noKey = !settings.anthropicKey;

  return (
    <>
      <h1>{mode === 'photo' ? 'Photograph a meal' : 'Describe a meal'}</h1>

      {noKey && (
        <p className="notice warn">
          Meal analysis needs your Anthropic API key. <Link to="/settings">Add it in Settings</Link>, or go back and use “Add manually”.
        </p>
      )}
      {!online && <p className="notice warn">You are offline. {mode === 'photo' ? 'Take the photo now and save it to analyse later.' : 'Analysis needs a connection; use “Add manually” on the home screen instead.'}</p>}

      {mode === 'photo' && (
        <>
          {showDrafts && drafts && drafts.length > 0 && (
            <section className="card">
              <h2>Photos waiting</h2>
              <ul className="draft-list">
                {drafts.map((d) => (
                  <li key={d.id}>
                    <span>{new Date(d.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}{d.note ? ` — ${d.note}` : ''}</span>
                    <span className="row">
                      <button className="btn small" onClick={() => { setImage(d.image); setDraftId(d.id!); setNote(d.note); setIsRestaurant(d.isRestaurant); }}>Use</button>
                      <button className="btn small danger" onClick={() => db.drafts.delete(d.id!)}>Discard</button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {preview && <img className="preview" src={preview} alt="The meal photo you chose" />}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={chosen} />
          <input ref={galleryRef} type="file" accept="image/*" hidden onChange={chosen} data-testid="gallery-input" />
          <div className="row">
            <button className="btn primary big" onClick={() => cameraRef.current?.click()}>📷 {image ? 'Retake' : 'Take photo'}</button>
            <button className="btn big" onClick={() => galleryRef.current?.click()}>Choose from gallery</button>
          </div>
        </>
      )}

      <label className="note-field">
        {mode === 'photo' ? 'Note (helps a lot for restaurant meals)' : 'What did you eat?'}
        <textarea
          rows={mode === 'photo' ? 3 : 5}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={mode === 'photo' ? 'e.g. chicken pad thai from Thai Garden, ate about half' : 'e.g. 2 scrambled eggs, 1 slice white toast with butter, half a banana'}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={isRestaurant} onChange={(e) => setIsRestaurant(e.target.checked)} />
        Restaurant or takeaway meal
      </label>

      {error && <p className="notice warn" role="alert">{error}</p>}

      <button className="btn primary big" onClick={analyse} disabled={busy || noKey || !online}>
        {busy ? 'Analysing… this can take up to a minute' : 'Analyse meal'}
      </button>
      {mode === 'photo' && image && (
        <button className="btn" onClick={saveForLater} disabled={busy}>Save photo to analyse later</button>
      )}
      <Link className="btn ghost" to="/">Cancel</Link>
    </>
  );
}
