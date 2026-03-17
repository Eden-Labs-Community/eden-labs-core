import { createEnvelope } from "../envelope/envelope.js";
import { EdenInvalidEventTypeError } from "../errors/errors.js";

describe("Envelope", () => {
  it("creates an envelope with a unique id", () => {
    const envelope = createEnvelope({ type: "eden:user:created", payload: {} });
    expect(envelope.id).toBeDefined();
  });

  it("creates two envelopes with different ids", () => {
    const a = createEnvelope({ type: "eden:user:created", payload: {} });
    const b = createEnvelope({ type: "eden:user:created", payload: {} });
    expect(a.id).not.toBe(b.id);
  });

  it("throws EdenInvalidEventTypeError for type without namespace", () => {
    expect(() => createEnvelope({ type: "created", payload: {} }))
      .toThrow(EdenInvalidEventTypeError);
  });

  it("throws EdenInvalidEventTypeError for type with only two parts", () => {
    expect(() => createEnvelope({ type: "eden:created", payload: {} }))
      .toThrow(EdenInvalidEventTypeError);
  });

  it("throws EdenInvalidEventTypeError for empty type", () => {
    expect(() => createEnvelope({ type: "", payload: {} }))
      .toThrow(EdenInvalidEventTypeError);
  });
});
