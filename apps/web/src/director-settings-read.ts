/** Setup and model-list reads share one owner. A newer read fences every older callback. */
export class DirectorSettingsReadGate {
  private version = 0;

  async run<T>(request: () => Promise<T>, signal: AbortSignal, handlers: {
    start(): void;
    success(value: T): void;
    failure(error: unknown): void;
    finish(): void;
  }): Promise<boolean> {
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
}
