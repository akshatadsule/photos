import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PreviewStore, type Preview } from './previews.ts';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  const started: string[] = [], released: string[] = [];
  const jobs = new Map<string, { resolve: (p: Preview) => void; reject: (e: Error) => void }>();
  const store = new PreviewStore(path => {
    started.push(path);
    return new Promise<Preview>((resolve, reject) => jobs.set(path, { resolve, reject }));
  }, url => released.push(url));
  const finish = (path: string) => jobs.get(path)!.resolve({ url: path, width: 6000, height: 4000 });
  return { store, started, released, jobs, finish };
}
test('previews are lazy, deduplicated and limited to two concurrent jobs', async () => {
  const f = fixture(); assert.deepEqual(f.started, []);
  f.store.request('a'); f.store.request('a'); f.store.request('b'); f.store.request('c');
  assert.deepEqual(f.started, ['a', 'b']);
  f.finish('a'); await tick(); assert.deepEqual(f.started, ['a', 'b', 'c']);
  f.finish('b'); f.finish('c'); await tick();
  f.store.request('a'); assert.deepEqual(f.started, ['a', 'b', 'c']);
  assert.equal(f.store.get('a')?.preview?.width, 6000);
  f.store.dispose(); assert.deepEqual(f.released.sort(), ['a', 'b', 'c']);
});
test('only listeners for the completed photo are notified; failures do not block queue', async () => {
  const f = fixture(); let a = 0, b = 0;
  f.store.subscribe('a', () => a++); const unsubscribe = f.store.subscribe('b', () => b++);
  f.store.request('a'); f.store.request('b'); f.store.request('c');
  f.jobs.get('a')!.reject(new Error('Missing file')); await tick();
  assert.equal(a, 1); assert.equal(b, 0); assert.equal(f.store.get('a')?.error, 'Missing file');
  assert.deepEqual(f.started, ['a', 'b', 'c']); unsubscribe();
  f.finish('b'); f.finish('c'); await tick(); assert.equal(b, 0); f.store.dispose();
});
test('switching projects cancels queued jobs and releases late thumbnails', async () => {
  const f = fixture(); let notifications = 0;
  f.store.subscribe('a', () => notifications++);
  f.store.request('a'); f.store.request('b'); f.store.request('c');
  f.store.dispose(); f.finish('a'); f.finish('b'); await tick(); f.store.request('d');
  assert.deepEqual(f.started, ['a', 'b']); assert.deepEqual(f.released.sort(), ['a', 'b']);
  assert.equal(notifications, 0); assert.equal(f.store.get('a'), undefined);
});
test('save validation shares in-flight and cached previews instead of decoding again', async () => {
  const f = fixture();
  f.store.request('a'); const first = f.store.ready('a'), second = f.store.ready('a');
  assert.deepEqual(f.started, ['a']); f.finish('a');
  assert.equal((await first).preview?.url, 'a'); assert.equal((await second).preview?.url, 'a');
  assert.equal((await f.store.ready('a')).preview?.url, 'a');
  assert.deepEqual(f.started, ['a']); f.store.dispose();
});
