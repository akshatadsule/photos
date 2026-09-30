export type Preview = { url: string; width: number; height: number };
export type PreviewState = { preview?: Preview; error?: string };

// One cache per project. Only requested images are read, with bounded decoding.
export class PreviewStore {
  private states = new Map<string, PreviewState>();
  private listeners = new Map<string, Set<() => void>>();
  private requested = new Set<string>();
  private queue: string[] = [];
  private active = 0;
  private disposed = false;
  private load: (path: string) => Promise<Preview>;
  private release: (url: string) => void;
  constructor(load: (path: string) => Promise<Preview>, release = (url: string) => URL.revokeObjectURL(url)) {
    this.load = load; this.release = release;
  }
  get = (path: string) => this.states.get(path);
  subscribe = (path: string, listener: () => void) => {
    const listeners = this.listeners.get(path) ?? new Set();
    listeners.add(listener); this.listeners.set(path, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(path); };
  };
  request(path: string) {
    if (this.disposed || this.requested.has(path)) return;
    this.requested.add(path); this.queue.push(path); this.pump();
  }
  async ready(path: string): Promise<PreviewState> {
    if (this.disposed) throw new Error('Project is closed.');
    const cached = this.get(path);
    if (cached) return cached;
    return new Promise(resolve => {
      const unsubscribe = this.subscribe(path, () => {
        const state = this.get(path);
        if (state) { unsubscribe(); resolve(state); }
      });
      this.request(path);
    });
  }
  private pump() {
    while (!this.disposed && this.active < 2 && this.queue.length) {
      const path = this.queue.shift()!; this.active++;
      void this.load(path).then(preview => {
        if (this.disposed) this.release(preview.url);
        else this.states.set(path, { preview });
      }, error => {
        if (!this.disposed) this.states.set(path, { error: error instanceof Error ? error.message : String(error) });
      }).finally(() => {
        this.active--;
        if (!this.disposed) for (const listener of this.listeners.get(path) ?? []) listener();
        this.pump();
      });
    }
  }
  dispose() {
    this.disposed = true; this.queue = []; this.listeners.clear();
    for (const state of this.states.values()) if (state.preview) this.release(state.preview.url);
    this.states.clear();
  }
}
