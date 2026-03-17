export class Deduplicator {
  private readonly seen$ = new Set<string>();

  seen(id: string): boolean {
    if (this.seen$.has(id)) return true;
    this.seen$.add(id);
    return false;
  }
}
