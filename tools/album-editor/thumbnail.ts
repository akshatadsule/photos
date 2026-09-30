import type { Preview } from './previews';
let worker: Worker | undefined;
let nextId = 0;
const jobs = new Map<number, { resolve: (preview: Preview) => void; reject: (error: Error) => void }>();
export function thumbnail(file: File): Promise<Preview> {
  if (!worker) {
    worker = new Worker(new URL('./thumbnail.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; blob: Blob; width: number; height: number; error?: string }>) => {
      const { id, blob, width, height, error } = event.data;
      const job = jobs.get(id); if (!job) return;
      jobs.delete(id);
      if (error) job.reject(new Error(error));
      else job.resolve({ url: URL.createObjectURL(blob), width, height });
    };
    worker.onerror = () => {
      worker?.terminate(); worker = undefined;
      for (const job of jobs.values()) job.reject(new Error('Image worker failed. Reload the project to retry.'));
      jobs.clear();
    };
  }
  return new Promise((resolve, reject) => {
    const id = nextId++; jobs.set(id, { resolve, reject });
    try { worker!.postMessage({ id, file }); }
    catch (error) { jobs.delete(id); reject(error); }
  });
}
