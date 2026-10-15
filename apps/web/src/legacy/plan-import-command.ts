/** Capture one immutable import request until its saved lifecycle is observed. */
export class PlanImportCommand {
  private saved: {
    path: string;
    body: { name: string; text: string; expectedHeadVersion: number };
    key: string;
  } | null = null;
  create(
    path: string,
    name: string,
    text: string,
    head: number,
    key: () => string,
  ) {
    const previous = this.saved;
    if (
      !previous ||
      previous.path !== path ||
      previous.body.name !== name ||
      previous.body.text !== text ||
      previous.body.expectedHeadVersion !== head
    )
      this.saved = Object.freeze({
        path,
        body: Object.freeze({ name, text, expectedHeadVersion: head }),
        key: key(),
      });
    return this.saved!;
  }
  observedSavedImport() {
    this.saved = null;
  }
}
