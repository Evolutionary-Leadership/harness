import { beforeEach, describe, expect, it } from "vitest";
import { recordingFake } from "../integration/helpers/fakes/recording";

/**
 * The fake pattern's two promises: state survives across calls within a test,
 * and call order is recorded across fakes. Both are what a test of a service
 * that talks to a third party asserts on, so they are pinned here once.
 */

type Mailer = {
  send(to: string, body: string): Promise<string>;
  bounce(id: string): Promise<void>;
};

type Ledger = {
  post(amount: number): number;
};

type Sent = { id: string; to: string; body: string };

function makeMailer() {
  return recordingFake<Mailer, { sent: Sent[] }>("mailer", { sent: [] }, (self) => ({
    async send(to, body) {
      const id = `m${self.state.sent.length + 1}`;
      self.state.sent.push({ id, to, body });
      return id;
    },
    async bounce(id) {
      self.state.sent = self.state.sent.filter((m) => m.id !== id);
    },
  }));
}

describe("recordingFake", () => {
  const mailer = makeMailer();
  const ledger = recordingFake<Ledger, { balance: number }>("ledger", { balance: 0 }, (self) => ({
    post: (amount) => (self.state.balance += amount),
  }));

  beforeEach(() => {
    mailer.reset();
    ledger.reset();
  });

  it("keeps state across calls and returns the implementation's result", async () => {
    const id = await mailer.fake.send("alice@example.invalid", "hello");
    await mailer.fake.send("bob@example.invalid", "hi");
    await mailer.fake.bounce(id);

    expect(mailer.state.sent.map((m) => m.to)).toEqual(["bob@example.invalid"]);
    expect(mailer.calls.map((c) => c.method)).toEqual(["send", "send", "bounce"]);
    expect(mailer.calls[2]?.args).toEqual([id]);
  });

  it("orders calls across fakes", async () => {
    ledger.fake.post(5);
    await mailer.fake.send("alice@example.invalid", "receipt");
    ledger.fake.post(-2);

    const order = [...ledger.calls, ...mailer.calls]
      .sort((a, b) => a.seq - b.seq)
      .map((c) => `${c.fake}.${c.method}`);
    expect(order).toEqual(["ledger.post", "mailer.send", "ledger.post"]);
    expect(ledger.state.balance).toBe(3);
  });

  it("reset restores the initial state without sharing it", () => {
    ledger.fake.post(10);
    ledger.reset();
    expect(ledger.state.balance).toBe(0);
    expect(ledger.calls).toEqual([]);
    ledger.fake.post(1);
    ledger.reset();
    expect(ledger.state.balance).toBe(0);
  });
});
