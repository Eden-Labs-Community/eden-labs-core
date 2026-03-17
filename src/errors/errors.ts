export class EdenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdenError";
  }
}

export class EdenInvalidEventTypeError extends EdenError {
  constructor(type: string) {
    super(
      `Invalid event type: "${type}". Expected format: "{namespace}:{domain}:{action}"`
    );
    this.name = "EdenInvalidEventTypeError";
  }
}

export class EdenInvalidEnvelopeError extends EdenError {
  constructor(reason: string) {
    super(`Invalid envelope: ${reason}`);
    this.name = "EdenInvalidEnvelopeError";
  }
}
