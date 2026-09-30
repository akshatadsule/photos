import React, { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { imagePattern, move, uniquePath, type Album, type Catalog, type Photo } from './model';
import { imageHandle, occupiedInAlbum, openProject, saveProject, type Session } from './files';
import { PreviewStore } from './previews';
import { thumbnail } from './thumbnail';
import './style.css';

const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
type Drag = { kind: 'album' | 'photo'; index: number } | undefined;
function usePreview(store: PreviewStore, path: string) {
  const subscribe = useCallback((listener: () => void) => store.subscribe(path, listener), [store, path]);
  const snapshot = useCallback(() => store.get(path), [store, path]);
  return useSyncExternalStore(subscribe, snapshot);
}
const PhotoCard = memo(function PhotoCard({ item, index, count, selected, busy, store, drag, select, reorder }: {
  item: Photo; index: number; count: number; selected: boolean; busy: boolean; store: PreviewStore;
  drag: React.RefObject<Drag>; select: (path: string) => void; reorder: (from: number, to: number) => void;
}) {
  const element = useRef<HTMLElement>(null);
  const state = usePreview(store, item.src);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { store.request(item.src); observer.disconnect(); }
    }, { rootMargin: '300px' });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, [store, item.src]);
  return <article ref={element} className={`photo-card ${selected ? 'selected' : ''}`} draggable={!busy}
    onDragStart={e => { drag.current = { kind: 'photo', index }; e.dataTransfer.setData('text/plain', item.src); }}
    onDragEnd={() => { drag.current = undefined; }} onDragOver={e => e.preventDefault()}
    onDrop={e => { if (drag.current?.kind === 'photo') { e.preventDefault(); e.stopPropagation(); if (!busy) reorder(drag.current.index, index); drag.current = undefined; } }}>
    <button className="photo-select" disabled={busy} onClick={() => select(item.src)} aria-label={`Edit photo ${index + 1}: ${item.alt || item.src}`}>
      {state?.preview ? <img draggable={false} src={state.preview.url} alt={item.alt} decoding="async"/> : <span className={state?.error ? 'missing' : 'placeholder'} title={state?.error}>{state?.error ? 'Image unavailable' : 'Loading…'}</span>}
      <span className="photo-position">{index + 1}</span>
    </button>
    <div className="photo-card-footer"><span title={item.src}>{item.title || item.src.split('/').pop()}<small>{item.alt ? '' : 'Alt text required'}</small></span><div className="row-controls">
      <button disabled={busy || index === 0} aria-label={`Move photo ${index + 1} earlier`} onClick={() => reorder(index, index - 1)}>←</button>
      <button disabled={busy || index === count - 1} aria-label={`Move photo ${index + 1} later`} onClick={() => reorder(index, index + 1)}>→</button>
    </div></div>
  </article>;
});
function Inspector({ photo, store, pending, busy, close, edit, remove }: {
  photo: Photo; store: PreviewStore; pending: boolean; busy: boolean; close: () => void; edit: (patch: Partial<Photo>) => void; remove: () => void;
}) {
  const state = usePreview(store, photo.src);
  useEffect(() => { store.request(photo.src); }, [store, photo.src]);
  return <aside className="inspector"><div className="section-heading"><span>Photo</span><button aria-label="Close photo details" onClick={close}>×</button></div>
    {state?.preview && <img className="detail-image" src={state.preview.url} alt={photo.alt}/>}
    {state?.error && <p className="missing">{state.error}</p>}
    <p className="filename">{photo.src}</p><p className="dimensions">{state?.preview && `${state.preview.width} × ${state.preview.height} px`}{pending ? ' · Pending import' : ''}</p>
    <fieldset disabled={busy}><label>Caption<textarea rows={3} value={photo.title ?? ''} onChange={e => edit({ title: e.target.value })}/></label>
      <label>Alt text <span className="required">required</span><textarea rows={3} value={photo.alt} onChange={e => edit({ alt: e.target.value })}/></label>
      <button className="text-danger" onClick={remove}>Remove photo</button>
    </fieldset>
  </aside>;
}
function App() {
  const [session, setSession] = useState<Session>();
  const [catalog, setCatalog] = useState<Catalog>({ albums: [] });
  const [selected, setSelected] = useState(0);
  const [photoSrc, setPhotoSrc] = useState<string>();
  const [store, setStore] = useState<PreviewStore>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(new Map<string, File>());
  const copied = useRef(new Set<string>());
  const occupied = useRef(new Set<string>());
  const drag = useRef<Drag>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const album = catalog.albums[selected];
  const photo = album?.photos.find(item => item.src === photoSrc);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || busy) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);
  useEffect(() => () => store?.dispose(), [store]);
  function edit(next: Catalog) { setCatalog(next); setDirty(true); setStatus(''); }
  function editAlbum(patch: Partial<Album>) {
    edit({ ...catalog, albums: catalog.albums.map((item, i) => i === selected ? { ...item, ...patch } : item) });
  }
  function editPhoto(patch: Partial<Photo>) {
    editAlbum({ photos: album.photos.map(item => item.src === photoSrc ? { ...item, ...patch } : item) });
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setError(error instanceof Error ? error.message : String(error));
      setStatus('');
    } finally { setBusy(false); }
  }
  async function load(root: FileSystemDirectoryHandle) {
    const result = await openProject(root);
    // Opening reads metadata only. Image files are loaded as they become visible.
    const imports = new Map<string, File>();
    pending.current = imports; copied.current.clear();
    occupied.current = new Set(result.catalog.albums.flatMap(a => a.photos.map(p => p.src.toLowerCase())));
    setStore(new PreviewStore(async path => {
      const file = imports.get(path) ?? await (await imageHandle(result.session.images, path)).getFile();
      return thumbnail(file);
    }));
    setCatalog(result.catalog); setSession(result.session); setSelected(0); setPhotoSrc(undefined); setDirty(false); setStatus('');
  }
  function open() {
    if (dirty && !confirm('Discard unsaved changes and open another project?')) return;
    void run(async () => { const root = await picker!.call(window, { mode: 'readwrite' }); await load(root); });
  }
  function addAlbum() {
    let n = 1; while (catalog.albums.some(a => a.slug === `new-album-${n}`)) n++;
    edit({ ...catalog, albums: [...catalog.albums, { slug: `new-album-${n}`, title: 'Untitled album', description: '', photos: [] }] });
    setSelected(catalog.albums.length); setPhotoSrc(undefined);
  }
  function reorderAlbums(from: number, to: number) {
    const current = catalog.albums[selected]; const albums = move(catalog.albums, from, to);
    edit({ ...catalog, albums }); setSelected(albums.indexOf(current));
  }
  const reorderPhotos = useCallback((from: number, to: number) => {
    setCatalog(current => ({ ...current, albums: current.albums.map((item, i) => i === selected ? { ...item, photos: move(item.photos, from, to) } : item) }));
    setDirty(true); setStatus('');
  }, [selected]);
  async function importFiles(files: File[]) {
    if (!album || !session || busy || !files.length) return;
    void run(async () => {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(album.slug)) throw new Error('Set a valid album slug before importing.');
      // Check only the destination folder, including unreferenced files. Re-scan
      // on each import so files added by other tools also receive safe suffixes.
      for (const path of await occupiedInAlbum(session.images, album.slug)) occupied.current.add(path);
      const added: Photo[] = []; const failures: string[] = [];
      for (const file of files) {
        if (!imagePattern.test(file.name)) { failures.push(`${file.name}: unsupported format`); continue; }
        const path = uniquePath(album.slug, file.name, occupied.current);
        pending.current.set(path, file); added.push({ src: path, alt: '' });
      }
      if (added.length) { editAlbum({ photos: [...album.photos, ...added] }); setPhotoSrc(added[0].src); }
      setStatus(`${added.length} photos added`);
      if (failures.length) setError(failures.join('\n'));
    });
  }
  return <div className="app">
    <header className="topbar"><strong>Album editor</strong><span className="project-name">{session?.root.name}</span><div className="toolbar">
      <span className={`save-state ${dirty ? 'unsaved' : ''}`}>{busy ? status || 'Working…' : dirty ? 'Unsaved' : session ? 'Saved' : ''}</span>
      <button disabled={busy || !picker} onClick={open}>{session ? 'Switch project' : 'Open project'}</button>
      {session && <><button disabled={busy} onClick={() => { if (!dirty || confirm('Discard unsaved changes and reload files from disk?')) void run(() => load(session.root)); }}>Reload</button>
        <button className="primary" disabled={busy || !dirty} onClick={() => void run(async () => {
          // Imports must decode successfully before writing; existing files are
          // checked by saveProject without requiring every thumbnail to load.
          for (const path of new Set(catalog.albums.flatMap(a => a.photos.map(p => p.src)))) {
            const file = pending.current.get(path);
            if (file && !copied.current.has(path)) {
              setStatus(`Checking ${path}…`);
              const state = await store!.ready(path);
              if (state.error) throw new Error(`Cannot read ${path}. Remove it and import a valid JPEG, PNG, or WebP image.`);
            }
          }
          await saveProject(session, catalog, pending.current, copied.current, setStatus);
          pending.current.clear(); copied.current.clear(); setDirty(false); setStatus('Saved');
        })}>Save</button></>}
    </div></header>
    {error && <div className="notice error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    <div className="status" role="status" aria-live="polite">{status}</div>
    {!session ? <main className="welcome"><p>Open the repository containing <code>src/data/albums.json</code>.</p><button className="primary" disabled={busy || !picker} onClick={open}>Open project</button>{!picker && <p>Use desktop Chrome on localhost for file access.</p>}</main> : <div className="workspace" aria-busy={busy}>
      <aside className="sidebar"><div className="section-heading"><span>Albums ({catalog.albums.length})</span><button disabled={busy} onClick={addAlbum} aria-label="Create album">＋</button></div>
        {catalog.albums.map((item, i) => <div key={i} className={`album-row ${i === selected ? 'active' : ''}`} draggable={!busy}
          onDragStart={e => { drag.current = { kind: 'album', index: i }; e.dataTransfer.setData('text/plain', item.slug); }} onDragEnd={() => { drag.current = undefined; }}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy && drag.current?.kind === 'album') reorderAlbums(drag.current.index, i); drag.current = undefined; }}>
          <button className="album-select" disabled={busy} onClick={() => { setSelected(i); setPhotoSrc(undefined); }}><strong>{item.title || 'Untitled album'}</strong><small>{item.photos.length}</small></button>
          <div className="row-controls"><button disabled={busy || i === 0} aria-label={`Move ${item.title} up`} onClick={() => reorderAlbums(i, i - 1)}>↑</button><button disabled={busy || i === catalog.albums.length - 1} aria-label={`Move ${item.title} down`} onClick={() => reorderAlbums(i, i + 1)}>↓</button></div>
        </div>)}
      </aside>
      <main className="editor">{album && store ? <>
        <fieldset disabled={busy} className="album-fields"><div className="metadata"><label>Title<input value={album.title} onChange={e => editAlbum({ title: e.target.value })}/></label><label>Slug<input value={album.slug} onChange={e => editAlbum({ slug: e.target.value })}/></label></div>
          <label>Description<textarea rows={2} value={album.description} onChange={e => editAlbum({ description: e.target.value })}/></label>
          <button className="text-danger" onClick={() => { if (confirm(`Remove “${album.title}” from the catalog? Image files will stay on disk.`)) { edit({ ...catalog, albums: catalog.albums.filter((_, i) => i !== selected) }); setSelected(Math.max(0, selected - 1)); setPhotoSrc(undefined); } }}>Remove album</button>
        </fieldset>
        <div className="photo-heading"><h2>Photos ({album.photos.length})</h2><button disabled={busy} onClick={() => input.current?.click()}>Add photos</button><input ref={input} type="file" hidden multiple accept=".jpg,.jpeg,.png,.webp" onChange={e => { void importFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}/></div>
        <div className={`photo-grid ${album.photos.length ? '' : 'empty-grid'}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) void importFiles(Array.from(e.dataTransfer.files)); }}>
          {album.photos.map((item, i) => <PhotoCard key={item.src} item={item} index={i} count={album.photos.length} selected={photoSrc === item.src} busy={busy} store={store} drag={drag} select={setPhotoSrc} reorder={reorderPhotos}/>)}
          {!album.photos.length && <button disabled={busy} onClick={() => input.current?.click()}>Drop images here or choose files</button>}
        </div>
      </> : <button className="primary" disabled={busy} onClick={addAlbum}>Create album</button>}</main>
      <div className="inspector-slot">{photo && store ? <Inspector photo={photo} store={store} pending={pending.current.has(photo.src)} busy={busy} close={() => setPhotoSrc(undefined)} edit={editPhoto} remove={() => { editAlbum({ photos: album.photos.filter(item => item.src !== photoSrc) }); setPhotoSrc(undefined); }}/> : <p className="inspector-placeholder">Select a photo to edit details.</p>}</div>
    </div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
