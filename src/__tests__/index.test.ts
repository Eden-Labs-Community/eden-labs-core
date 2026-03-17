import {
  Eden,
  EdenError,
  EdenInvalidEventTypeError,
  EdenInvalidEnvelopeError,
} from "../index.js";
import type { EventEnvelope } from "../index.js";

describe("public API", () => {
  it("exports Eden", () => {
    expect(Eden).toBeDefined();
  });

  it("exports EdenError", () => {
    expect(EdenError).toBeDefined();
  });

  it("exports EdenInvalidEventTypeError", () => {
    expect(EdenInvalidEventTypeError).toBeDefined();
  });

  it("exports EdenInvalidEnvelopeError", () => {
    expect(EdenInvalidEnvelopeError).toBeDefined();
  });

  it("EventEnvelope type is usable", () => {
    const envelope: EventEnvelope = {
      id: "1",
      type: "eden:user:created",
      payload: {},
      timestamp: Date.now(),
      version: "1.0.0",
    };
    expect(envelope.id).toBe("1");
  });
});
