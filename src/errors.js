export class RedHandedError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RedHandedError';
    this.code = code;
    this.details = details;
  }
}

export function invariant(condition, code, message, details) {
  if (!condition) throw new RedHandedError(code, message, details);
}
