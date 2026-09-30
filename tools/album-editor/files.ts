import { parseCatalog, safePath, serialize, validate, type Catalog } from './model.ts';
export type Folder = FileSystemDirectoryHandle;
export type Session = { root: Folder; images: Folder; metadata: FileSystemFileHandle; baseline: string };
export type Pending = Map<string, File>;
export async function directory(root: Folder, parts: string[], create = false): Promise<Folder> {
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create });
  return current;
}
export async function imageHandle(images: Folder, path: string, create = false) {
  if (!safePath(path)) throw new Error('Unsafe image path.');
  const parts = path.split('/'); const name = parts.pop()!;
  return (await directory(images, parts, create)).getFileHandle(name, { create });
}
export async function openProject(root: Folder) {
  const src = await directory(root, ['src']);
  const metadata = await (await directory(src, ['data'])).getFileHandle('albums.json');
  const baseline = await (await metadata.getFile()).text();
  const catalog = parseCatalog(baseline);
  const images = await directory(src, ['images']);
  return { session: { root, metadata, images, baseline }, catalog };
}
export async function occupiedInAlbum(images: Folder, slug: string): Promise<Set<string>> {
  const paths = new Set<string>();
  let folder: Folder;
  try { folder = await images.getDirectoryHandle(slug); }
  catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return paths; throw error; }
  for await (const [name] of (folder as Folder & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
    paths.add(`${slug}/${name}`.toLowerCase());
  }
  return paths;
}
async function write(handle: FileSystemFileHandle, data: File | string) {
  const stream = await handle.createWritable();
  try { await stream.write(data); await stream.close(); }
  catch (error) { await stream.abort().catch(() => {}); throw error; }
}
async function sameBytes(a: File, b: File) {
  if (a.size !== b.size) return false;
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const left = new Uint8Array(x), right = new Uint8Array(y);
  return left.every((byte, index) => byte === right[index]);
}
export async function saveProject(session: Session, catalog: Catalog, pending: Pending, copied: Set<string>, progress: (message: string) => void) {
  validate(catalog);
  const check = async () => {
    if (await (await session.metadata.getFile()).text() !== session.baseline) throw new Error('albums.json changed outside the editor. Reload the project before saving; your draft is still open.');
  };
  const permissionHandle = session.root as Folder & {
    queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  };
  if (permissionHandle.queryPermission && await permissionHandle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    if (await permissionHandle.requestPermission?.({ mode: 'readwrite' }) !== 'granted') throw new Error('Write access was denied. Your draft is still open; allow access and retry Save.');
  }
  await check();
  const paths = new Set(catalog.albums.flatMap(album => album.photos.map(photo => photo.src)));
  for (const path of paths) {
    const file = pending.get(path);
    if (!file) { await (await imageHandle(session.images, path)).getFile(); continue; }
    progress(`Saving ${path}…`);
    let existing: File | undefined;
    try { existing = await (await imageHandle(session.images, path)).getFile(); }
    catch (error) { if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error; }
    if (existing) {
      if (!copied.has(path) || !await sameBytes(existing, file)) throw new Error(`Image already exists: ${path}. No existing image was overwritten. Reload and import it again.`);
    } else {
      await write(await imageHandle(session.images, path, true), file);
      copied.add(path);
    }
  }
  await check();
  progress('Saving album details…');
  const text = serialize(catalog);
  await write(session.metadata, text);
  session.baseline = text;
}
