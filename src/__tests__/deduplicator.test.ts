import { Deduplicator } from "../deduplicator/deduplicator.js";

describe("Deduplicator", () => {
  it("returns false for a new id", () => {
    const deduplicator = new Deduplicator();
    expect(deduplicator.seen("abc")).toBe(false);
  });

  it("returns true for an already seen id", () => {
    const deduplicator = new Deduplicator();
    deduplicator.seen("abc");
    expect(deduplicator.seen("abc")).toBe(true);
  });
});
