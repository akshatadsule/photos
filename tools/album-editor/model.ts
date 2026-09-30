export type Photo = { src: string; alt: string; title?: string; [key: string]: unknown };
export type Album = { slug: string; title: string; description: string; photos: Photo[]; [key: string]: unknown };
export type Catalog = { albums: Album[]; [key: string]: unknown };
export const imagePattern = /\.(jpe?g|png|webp)$/i;
export function safePath(path: string) {
  return path.split('/').every(part => !!part && part !== '.' && part !== '..' && !/[\\:\x00-\x1f]/.test(part)) && !path.startsWith('/');
}
export function parseCatalog(text: string): Catalog {
  const value = JSON.parse(text);
  if (!value || !Array.isArray(value.albums)) throw new Error('Expected an albums array in src/data/albums.json.');
  for (const album of value.albums) {
    if (!album || typeof album.slug !== 'string' || typeof album.title !== 'string' || typeof album.description !== 'string' || !Array.isArray(album.photos)) throw new Error('Invalid album metadata.');
    for (const photo of album.photos) {
      if (!photo || typeof photo.src !== 'string' || !safePath(photo.src) || !imagePattern.test(photo.src) || typeof photo.alt !== 'string' || (photo.title !== undefined && typeof photo.title !== 'string')) throw new Error('Invalid photo metadata or unsafe image path.');
    }
  }
  return value;
}
export function validate(catalog: Catalog) {
  parseCatalog(JSON.stringify(catalog));
  const slugs = new Set<string>();
  for (const album of catalog.albums) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(album.slug) || slugs.has(album.slug)) throw new Error('Album slugs must be unique lowercase words separated by hyphens.');
    slugs.add(album.slug);
    if (!album.title.trim()) throw new Error('Every album needs a title.');
    if (album.photos.some(photo => !photo.alt.trim())) throw new Error(`Add alt text to every photo in “${album.title}”.`);
  }
}
export function filename(name: string) {
  const dot = name.lastIndexOf('.');
  const stem = name.slice(0, dot).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'photo';
  return stem + name.slice(dot).toLowerCase();
}
export function uniquePath(folder: string, name: string, occupied: Set<string>) {
  const clean = filename(name); const dot = clean.lastIndexOf('.');
  let path = `${folder}/${clean}`; let suffix = 2;
  while (occupied.has(path.toLowerCase())) path = `${folder}/${clean.slice(0, dot)}-${suffix++}${clean.slice(dot)}`;
  occupied.add(path.toLowerCase()); return path;
}
export function move<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const result = [...items]; result.splice(to, 0, result.splice(from, 1)[0]); return result;
}
export function serialize(catalog: Catalog) {
  return JSON.stringify({ ...catalog, albums: catalog.albums.map(album => ({ ...album, photos: album.photos.map(photo => {
    const copy = { ...photo }; if (!copy.title?.trim()) delete copy.title; return copy;
  }) })) }, null, 2) + '\n';
}
