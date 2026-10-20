/** An explicit data failure value; ordinary thrown errors remain fatal. */
export class Invalid {
  constructor(readonly code: string, readonly message: string) {}
}

export function invalid(code: string, message: string): Invalid {
  return new Invalid(code, message);
}
