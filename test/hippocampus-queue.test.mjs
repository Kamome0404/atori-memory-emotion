import test from "node:test";
import assert from "node:assert/strict";
import { HippocampusQueue } from "../hippocampus/hippocampus-queue.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("sends jobs in FIFO order with one consumer", async () => {
  const seen = [];
  const queue = new HippocampusQueue({
    capacity: 8,
    send: async (job) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      seen.push(job.id);
    },
  });
  const a = queue.enqueue({ id: "synthetic-a" });
  const b = queue.enqueue({ id: "synthetic-b" });
  const c = queue.enqueue({ id: "synthetic-c" });

  assert.equal((await a.result).status, "sent");
  assert.equal((await b.result).status, "sent");
  assert.equal((await c.result).status, "sent");
  assert.deepEqual(seen, ["synthetic-a", "synthetic-b", "synthetic-c"]);
  assert.equal(queue.stats().counts.sent, 3);
});

test("rejects new jobs at the bound without waiting", async () => {
  const gate = deferred();
  const queue = new HippocampusQueue({ capacity: 1, send: () => gate.promise });
  const first = queue.enqueue({ id: "synthetic-first" });
  await tick();
  const second = queue.enqueue({ id: "synthetic-second" });

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.reason, "full");
  assert.equal(queue.stats().counts.rejectedFull, 1);

  gate.resolve();
  assert.equal((await first.result).status, "sent");
});

test("records a send exception without retrying it", async () => {
  const calls = [];
  const queue = new HippocampusQueue({
    send: async (job) => {
      calls.push(job.id);
      if (job.id === "synthetic-bad") throw new Error("synthetic failure");
    },
  });
  const bad = queue.enqueue({ id: "synthetic-bad" });
  const good = queue.enqueue({ id: "synthetic-good" });

  assert.equal((await bad.result).status, "failed");
  assert.equal((await good.result).status, "sent");
  assert.deepEqual(calls, ["synthetic-bad", "synthetic-good"]);
  assert.equal(queue.stats().counts.failed, 1);
});

test("close deadline returns unconfirmed jobs and never retries an in-flight send", async () => {
  const gate = deferred();
  let calls = 0;
  const queue = new HippocampusQueue({
    capacity: 2,
    send: () => {
      calls += 1;
      return gate.promise;
    },
  });
  const first = queue.enqueue({ id: "synthetic-in-flight" });
  const second = queue.enqueue({ id: "synthetic-pending" });
  const report = await queue.close({ deadlineMs: 5 });

  assert.equal(report.deadline, true);
  assert.equal(report.unconfirmed, 2);
  assert.equal(queue.status(), "closed");
  assert.equal(queue.stats().waiters, 0);
  assert.equal((await first.result).status, "unconfirmed");
  assert.equal((await second.result).status, "unconfirmed");
  assert.equal(calls, 1);

  gate.resolve();
  await tick();
  assert.equal(queue.stats().counts.lateSent, 1);
  assert.equal(calls, 1);
});

test("flush deadline reports pending work without claiming success", async () => {
  const gate = deferred();
  const queue = new HippocampusQueue({ capacity: 1, send: () => gate.promise });
  const item = queue.enqueue({ id: "synthetic-timeout" });
  const report = await queue.flush({ deadlineMs: 5 });

  assert.equal(report.deadline, true);
  assert.equal(report.unconfirmed, 1);
  assert.equal(queue.pendingCount(), 1);
  assert.equal(item.accepted, true);

  gate.resolve();
  assert.equal((await item.result).status, "sent");
});

test("flush timeout cancels its waiter instead of accumulating it", async () => {
  const gate = deferred();
  const queue = new HippocampusQueue({ capacity: 1, send: () => gate.promise });
  queue.enqueue({ id: "synthetic-waiter" });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const report = await queue.flush({ deadlineMs: 1 });
    assert.equal(report.deadline, true);
    assert.equal(queue.stats().waiters, 0);
  }
  gate.resolve();
});

test("successful flush clears its timer and waiter", async () => {
  const gate = deferred();
  const queue = new HippocampusQueue({ send: () => gate.promise });
  queue.enqueue({ id: "synthetic-fast-drain" });
  const flushing = queue.flush({ deadlineMs: 1_000 });
  await tick();
  gate.resolve();
  const report = await flushing;

  assert.equal(report.deadline, false);
  assert.equal(report.unconfirmed, 0);
  assert.equal(queue.stats().waiters, 0);
});


test("successful finite close clears its timer and waiter", async () => {
  const gate = deferred();
  const queue = new HippocampusQueue({ send: () => gate.promise });
  const item = queue.enqueue({ id: "synthetic-close-fast-drain" });
  const closing = queue.close({ deadlineMs: 1_000 });
  await tick();
  gate.resolve();
  const report = await closing;

  assert.equal(report.deadline, false);
  assert.equal(report.unconfirmed, 0);
  assert.equal(queue.stats().waiters, 0);
  assert.equal((await item.result).status, "sent");
});

test("close supports Infinity and rejects negative deadlines", async () => {
  const gate = deferred();
  const queue = new HippocampusQueue({ send: () => gate.promise });
  const item = queue.enqueue({ id: "synthetic-infinity" });
  const closing = queue.close({ deadlineMs: Infinity });
  await tick();
  gate.resolve();
  assert.equal((await closing).deadline, false);
  assert.equal((await item.result).status, "sent");

  await assert.rejects(() => queue.flush({ deadlineMs: -1 }), TypeError);
  await assert.rejects(() => queue.close({ deadlineMs: -1 }), TypeError);
});

test("send failure event contains no exception object", async () => {
  const events = [];
  const queue = new HippocampusQueue({
    onEvent: (event) => events.push(event),
    send: async () => { throw new Error("synthetic secret"); },
  });
  const item = queue.enqueue({ id: "synthetic-error" });
  assert.equal((await item.result).status, "failed");
  const failure = events.find((event) => event.type === "send_failed");
  assert.deepEqual(failure, { type: "send_failed", id: "job-1" });
});

test("rejects intake after close", async () => {
  const queue = new HippocampusQueue({ send: async () => {} });
  await queue.close({ deadlineMs: 10 });
  const result = queue.enqueue({ id: "synthetic-after-close" });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "closed");
});
