interface DirectorReadHandlers<T> {
  start(): void;
  success(value: T): void;
  failure(error: unknown): void;
  finish(): void;
}

/** Setup and model-list reads share one owner. A newer read fences every older callback. */
export class DirectorSettingsReadGate {
  private version = 0;

  async run<T>(request: () => Promise<T>, signal: AbortSignal, handlers: DirectorReadHandlers<T>): Promise<boolean> {
    const version = ++this.version;
    const current = () => version === this.version && !signal.aborted;
    handlers.start();
    try {
      const value = await request();
      if (!current()) return false;
      handlers.success(value);
      return true;
    } catch (error) {
      if (!current()) return false;
      handlers.failure(error);
      return true;
    } finally {
      if (current()) handlers.finish();
    }
  }

  /** Discovery can fill the server cache even when a newer setup read supersedes its reply. */
  async runCatalog<T>(request: () => Promise<T>, signal: AbortSignal, handlers: DirectorReadHandlers<T>, refreshSetup: () => void): Promise<boolean> {
    const published = await this.run(request, signal, handlers);
    // Re-read current setup rather than publishing the discarded model selection/busy state.
    // Aborted discovery belongs to an old mount or a replaced request and must stay silent.
    if (!published && !signal.aborted) refreshSetup();
    return published;
  }
}
