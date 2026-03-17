import { EdenError, EdenInvalidEventTypeError, EdenInvalidEnvelopeError } from "../errors/errors.js";

describe("EdenError", () => {
  it("is an instance of Error", () => {
    const error = new EdenError("something failed");
    expect(error).toBeInstanceOf(Error);
  });

  it("has the correct name", () => {
    const error = new EdenError("something failed");
    expect(error.name).toBe("EdenError");
  });
});

describe("EdenInvalidEventTypeError", () => {
  it("is an instance of EdenError", () => {
    const error = new EdenInvalidEventTypeError("bad-type");
    expect(error).toBeInstanceOf(EdenError);
  });

  it("includes the invalid type in the message", () => {
    const error = new EdenInvalidEventTypeError("bad-type");
    expect(error.message).toContain("bad-type");
  });
});

describe("EdenInvalidEnvelopeError", () => {
  it("is an instance of EdenError", () => {
    const error = new EdenInvalidEnvelopeError("missing id");
    expect(error).toBeInstanceOf(EdenError);
  });

  it("includes the reason in the message", () => {
    const error = new EdenInvalidEnvelopeError("missing id");
    expect(error.message).toContain("missing id");
  });
});
