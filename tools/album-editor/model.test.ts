import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { move, parseCatalog, safePath, serialize, uniquePath, validate, type Catalog } from './model.ts';
import { occupiedInAlbum, openProject, saveProject, type Folder, type Session } from './files.ts';

test('existing catalog round-trips without losing metadata or order', async () => {
  const original = JSON.parse(await readFile(new URL('../../src/data/albums.json', import.meta.url), 'utf8'));
  assert.deepEqual(parseCatalog(serialize(original)), original); validate(original);
});
test('caption omission preserves alt fallback and unknown metadata', () => {
  const catalog: Catalog = { custom: true, albums: [{ slug: 'birds', title: 'Birds', description: '', photos: [{ src: 'birds/a.jpg', alt: 'Bird', title: ' ', rating: 5 }] }] };
  const result = parseCatalog(serialize(catalog));
  assert.equal(result.albums[0].photos[0].title, undefined);
  assert.equal(result.albums[0].photos[0].alt, 'Bird');
  assert.equal(result.albums[0].photos[0].rating, 5);
  assert.equal(result.custom, true);
});
test('paths, duplicate slugs and missing alt text are rejected', () => {
  for (const path of ['../secret.jpg', '/a.jpg', 'a/../b.jpg', 'a\\b.jpg', 'a//b.jpg', 'C:/a.jpg']) assert.equal(safePath(path), false);
  const album = { slug: 'birds', title: 'Birds', description: '', photos: [] };
  assert.throws(() => validate({ albums: [album, album] }), /unique/);
  assert.throws(() => validate({ albums: [{ ...album, slug: '../x' }] }), /slugs/);
  assert.throws(() => validate({ albums: [{ ...album, photos: [{ src: 'a.jpg', alt: '' }] }] }), /alt text/);
});
test('filenames avoid case-insensitive collisions; ordering is immutable', () => {
  const occupied = new Set(['birds/my-photo.jpg']);
  assert.equal(uniquePath('birds', 'My Photo.JPG', occupied), 'birds/my-photo-2.jpg');
  assert.equal(uniquePath('birds', 'My Photo.JPG', occupied), 'birds/my-photo-3.jpg');
  const items = ['a', 'b', 'c']; assert.deepEqual(move(items, 0, 2), ['b', 'c', 'a']); assert.deepEqual(items, ['a', 'b', 'c']);
  assert.deepEqual(move(items, 0, -1), items);
});
function fixture() {
  const files = new Map<string, File>();
  const writes: string[] = [];
  let failMetadata = false;
  const handle = (path: string) => ({
    getFile: async () => { if (!files.has(path)) throw new DOMException('Missing', 'NotFoundError'); return files.get(path)!; },
    createWritable: async () => {
      let staged: File | string;
      return { write: async (data: File | string) => { staged = data; }, close: async () => {
        if (path === 'albums.json' && failMetadata) throw new Error('Disk full');
        files.set(path, typeof staged === 'string' ? new File([staged], path) : staged); writes.push(path);
      }, abort: async () => {} };
    }
  });
  const folder = (prefix = ''): unknown => ({
    getDirectoryHandle: async (name: string) => folder(prefix + name + '/'),
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      const path = prefix + name;
      if (!files.has(path) && !options?.create) throw new DOMException('Missing', 'NotFoundError');
      return handle(path);
    }
  });
  const baseline = '{"albums":[]}\n'; files.set('albums.json', new File([baseline], 'albums.json'));
  const session = { baseline, metadata: handle('albums.json'), images: folder(), root: folder() } as Session;
  const catalog: Catalog = { albums: [{ slug: 'birds', title: 'Birds', description: '', photos: [{ src: 'birds/a.jpg', alt: 'A bird', title: 'Hello' }] }] };
  const original = new File([new Uint8Array([255, 216, 1, 2, 3])], 'a.jpg');
  const pending = new Map([['birds/a.jpg', original]]);
  return { files, writes, session, catalog, original, pending, fail: (value: boolean) => { failMetadata = value; } };
}
test('save preserves image bytes, writes JSON last and removal keeps originals', async () => {
  const f = fixture(); await saveProject(f.session, f.catalog, f.pending, new Set(), () => {});
  assert.deepEqual(f.writes, ['birds/a.jpg', 'albums.json']);
  assert.deepEqual(await f.files.get('birds/a.jpg')!.arrayBuffer(), await f.original.arrayBuffer());
  await saveProject(f.session, { albums: [] }, new Map(), new Set(), () => {});
  assert.ok(f.files.has('birds/a.jpg'));
});
test('outside metadata edits block all writes', async () => {
  const f = fixture(); f.files.set('albums.json', new File(['{"albums":[],"external":true}'], 'albums.json'));
  await assert.rejects(saveProject(f.session, f.catalog, f.pending, new Set(), () => {}), /changed outside/);
  assert.equal(f.writes.length, 0);
});
test('failed metadata save can retry without rewriting copied images', async () => {
  const f = fixture(); const copied = new Set<string>(); f.fail(true);
  await assert.rejects(saveProject(f.session, f.catalog, f.pending, copied, () => {}), /Disk full/);
  f.fail(false); await saveProject(f.session, f.catalog, f.pending, copied, () => {});
  assert.deepEqual(f.writes, ['birds/a.jpg', 'albums.json']);
});
test('an externally created image is never overwritten', async () => {
  const f = fixture(); f.files.set('birds/a.jpg', new File(['external'], 'a.jpg'));
  await assert.rejects(saveProject(f.session, f.catalog, f.pending, new Set(), () => {}), /already exists/);
  assert.equal(f.writes.length, 0);
});

test('denied permission retains draft and does not write files', async () => {
  const f = fixture();
  Object.assign(f.session.root, { queryPermission: async () => 'prompt', requestPermission: async () => 'denied' });
  await assert.rejects(saveProject(f.session, f.catalog, f.pending, new Set(), () => {}), /Write access was denied/);
  assert.equal(f.writes.length, 0); assert.equal(f.pending.size, 1);
});
test('renewed write permission allows saving', async () => {
  const f = fixture();
  Object.assign(f.session.root, { queryPermission: async () => 'prompt', requestPermission: async () => 'granted' });
  await saveProject(f.session, f.catalog, f.pending, new Set(), () => {});
  assert.deepEqual(f.writes, ['birds/a.jpg', 'albums.json']);
});

test('opening a project reads only metadata, without scanning or reading images', async () => {
  const reads: string[] = [];
  const images = { entries: () => { throw new Error('Unexpected image scan'); }, getFileHandle: () => { throw new Error('Unexpected image read'); } };
  const data = { getFileHandle: async (name: string) => ({ getFile: async () => { reads.push(name); return new File(['{"albums":[]}'], name); } }) };
  const src = { getDirectoryHandle: async (name: string) => name === 'data' ? data : images };
  const root = { getDirectoryHandle: async () => src } as unknown as Folder;
  const result = await openProject(root);
  assert.deepEqual(result.catalog, { albums: [] }); assert.deepEqual(reads, ['albums.json']);
});
test('imports scan only destination entries and reserve unreferenced files and directories', async () => {
  const folders: string[] = [];
  const root = { getDirectoryHandle: async (name: string) => {
    folders.push(name);
    return { entries: async function* () {
      yield ['ORIGINAL.JPG', { kind: 'file' }];
      yield ['original-2.jpg', { kind: 'directory' }];
    } };
  } } as unknown as Folder;
  const occupied = await occupiedInAlbum(root, 'birds');
  assert.deepEqual(folders, ['birds']);
  assert.equal(uniquePath('birds', 'Original.JPG', occupied), 'birds/original-3.jpg');
  const missing = { getDirectoryHandle: async () => { throw new DOMException('Missing', 'NotFoundError'); } } as unknown as Folder;
  assert.equal((await occupiedInAlbum(missing, 'new-album')).size, 0);
});
