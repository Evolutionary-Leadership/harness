/**
 * One stateful fake per third party, one file each, in this directory.
 *
 * The foundation calls no third party over the network today (Postgres is real
 * in the integration tier, Better Auth is a library). When the first one
 * arrives, its client gets an interface in src/ and a fake here, built on
 * `recordingFake`: the fake holds whatever state the real service would (the
 * issues it was told to create, the messages it was sent) and records every
 * call in order, so a test asserts on effects and sequence rather than on
 * mocks. A new client method is then a one-file edit: add it to the fake.
 *
 * Usage:
 *
 *   type Mailer = { send(to: string, body: string): Promise<void> };
 *   const mailer = recordingFake<Mailer, { sent: { to: string; body: string }[] }>(
 *     "mailer",
 *     { sent: [] },
 *     (self) => ({
 *       async send(to, body) { self.state.sent.push({ to, body }); },
 *     }),
 *   );
 *
 *   await service(mailer.fake).welcome(user);
 *   expect(mailer.calls.map((c) => c.method)).toEqual(["send"]);
 *   expect(mailer.state.sent[0]?.to).toBe(user.email);
 */

export type RecordedCall = {
  /** Which fake, so calls across several fakes can be merged and ordered. */
  fake: string;
  method: string;
  args: unknown[];
  /** Position in the run-wide call order, shared by every fake in the process. */
  seq: number;
};

export type RecordingFake<T extends object, S> = {
  /** Hand this to the code under test wherever the real client goes. */
  fake: T;
  /** Every call, in order. */
  calls: RecordedCall[];
  /** Whatever the real service would remember. */
  state: S;
  /** Clear calls and restore the initial state; call it in beforeEach. */
  reset: () => void;
};

let sequence = 0;

/** Ordered across every fake in the process, so cross-service sequences are assertable. */
export function nextSequence(): number {
  sequence += 1;
  return sequence;
}

type Method = (...args: never[]) => unknown;

/**
 * Build the fake from `implement`, which receives the handle so a method can
 * read and write `handle.state` at call time (never capture the state object
 * itself: reset replaces it). Every method call is recorded before it runs.
 * `initialState` is cloned with structuredClone on reset, so it must be plain
 * data.
 */
export function recordingFake<T extends object, S>(
  name: string,
  initialState: S,
  implement: (handle: { state: S }) => T,
): RecordingFake<T, S> {
  const calls: RecordedCall[] = [];
  const handle: RecordingFake<T, S> = {
    fake: {} as T,
    calls,
    state: structuredClone(initialState),
    reset: () => {
      calls.length = 0;
      handle.state = structuredClone(initialState);
    },
  };
  const implementation = implement(handle);

  handle.fake = new Proxy(implementation, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function" || typeof property !== "string") return value;
      return (...args: unknown[]) => {
        calls.push({ fake: name, method: property, args, seq: nextSequence() });
        return (value as Method).apply(target, args as never[]);
      };
    },
  });

  return handle;
}
