/**
 * In-memory, bounded, single-consumer async send queue.
 *
 * This is a process-local buffer, not a durable queue. A send that has not
 * settled before close's deadline is reported as unconfirmed and is never
 * retried automatically.
 */

export class HippocampusQueue {
  constructor({ capacity = 64, send, onEvent = () => {}, idPrefix = "job" } = {}) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new TypeError("capacity must be a positive safe integer");
    }
    if (typeof send !== "function") {
      throw new TypeError("send must be a function");
    }
    if (typeof onEvent !== "function") {
      throw new TypeError("onEvent must be a function");
    }

    this.capacity = capacity;
    this.send = send;
    this.onEvent = onEvent;
    this.idPrefix = String(idPrefix);
    this.state = "open";
    this.nextId = 1;
    this.queue = [];
    this.inFlight = null;
    this.pumpRunning = false;
    this.drainWaiters = [];
    this.counts = {
      accepted: 0,
      sent: 0,
      failed: 0,
      rejectedFull: 0,
      rejectedClosed: 0,
      unconfirmed: 0,
      lateSent: 0,
      lateFailed: 0,
    };
  }

  /**
   * Synchronously attempts to add a job. `result` settles when the send is
   * confirmed, failed, or declared unconfirmed by close's deadline.
   */
  enqueue(job) {
    if (this.state !== "open") {
      this.counts.rejectedClosed += 1;
      return { accepted: false, reason: "closed", result: Promise.resolve({ status: "rejected", reason: "closed" }) };
    }
    if (this.queue.length + (this.inFlight ? 1 : 0) >= this.capacity) {
      this.counts.rejectedFull += 1;
      this.emit({ type: "queue_full", capacity: this.capacity });
      return { accepted: false, reason: "full", result: Promise.resolve({ status: "rejected", reason: "full" }) };
    }

    const id = `${this.idPrefix}-${this.nextId++}`;
    let resolveResult;
    const result = new Promise((resolve) => { resolveResult = resolve; });
    const ticket = { id, job, resolveResult, result, resultSettled: false };
    this.queue.push(ticket);
    this.counts.accepted += 1;
    this.emit({ type: "enqueued", id });
    this.pump();
    return { accepted: true, id, result };
  }

  /** Waits for currently accepted jobs to settle, or returns at deadline. */
  async flush({ deadlineMs = 0 } = {}) {
    this.validateDeadline(deadlineMs);
    if (this.pendingCount() === 0) {
      return this.report(0, false);
    }
    const didDrain = await this.waitForDrainUntil(deadlineMs);
    return this.report(didDrain ? 0 : this.pendingCount(), !didDrain);
  }

  /** Stops intake and drains until the deadline. Pending work is discarded on timeout. */
  async close({ deadlineMs = 5_000 } = {}) {
    this.validateDeadline(deadlineMs);
    if (this.state === "closed") {
      return this.report(this.pendingCount(), false);
    }
    this.state = "closing";
    this.pump();
    const didDrain = this.pendingCount() === 0
      ? true
      : await this.waitForDrainUntil(deadlineMs);

    const unconfirmed = this.pendingCount();
    if (!didDrain) {
      this.markUnconfirmed("close_deadline");
      this.emit({ type: "close_deadline", unconfirmed });
    }
    this.state = "closed";
    this.notifyDrain();
    return this.report(unconfirmed, !didDrain);
  }

  validateDeadline(deadlineMs) {
    if ((!Number.isFinite(deadlineMs) && deadlineMs !== Infinity) || deadlineMs < 0) {
      throw new TypeError("deadlineMs must be a non-negative number or Infinity");
    }
  }

  async waitForDrainUntil(deadlineMs) {
    const waiter = this.waitForDrain();
    let timerId;
    try {
      if (deadlineMs === Infinity) {
        await waiter.promise;
        return true;
      }
      const timeout = new Promise((resolve) => {
        timerId = setTimeout(() => resolve(false), deadlineMs);
      });
      return await Promise.race([waiter.promise.then(() => true), timeout]);
    } finally {
      if (timerId !== undefined) clearTimeout(timerId);
      waiter.cancel();
    }
  }

  status() {
    return this.state;
  }

  pendingCount() {
    return this.queue.length + (this.inFlight ? 1 : 0);
  }

  stats() {
    return {
      state: this.state,
      capacity: this.capacity,
      queued: this.queue.length,
      inFlight: this.inFlight ? 1 : 0,
      pending: this.pendingCount(),
      waiters: this.drainWaiters.length,
      counts: { ...this.counts },
    };
  }

  report(unconfirmed, deadline) {
    return { ...this.stats(), unconfirmed, deadline };
  }

  emit(event) {
    try {
      this.onEvent(event);
    } catch {
      // Telemetry must never break queue processing.
    }
  }

  pump() {
    if (this.pumpRunning) return;
    this.pumpRunning = true;
    void this.runPump();
  }

  async runPump() {
    try {
      while (this.queue.length > 0 && !this.inFlight) {
        const ticket = this.queue.shift();
        this.inFlight = ticket;
        this.emit({ type: "send_started", id: ticket.id });
        let outcome;
        try {
          await Promise.resolve().then(() => this.send(ticket.job));
          outcome = "sent";
        } catch (error) {
          outcome = "failed";
          this.emit({ type: "send_failed", id: ticket.id });
        }
        const late = ticket.resultSettled;
        if (outcome === "sent") {
          if (late) this.counts.lateSent += 1;
          else this.counts.sent += 1;
        } else if (late) {
          this.counts.lateFailed += 1;
        } else {
          this.counts.failed += 1;
        }
        if (!late) this.resolve(ticket, { status: outcome, id: ticket.id });
        this.inFlight = null;
        this.notifyDrain();
      }
    } finally {
      this.pumpRunning = false;
      this.notifyDrain();
      if (this.queue.length > 0 && !this.inFlight && this.state !== "closed") this.pump();
    }
  }

  resolve(ticket, value) {
    if (ticket.resultSettled) return;
    ticket.resultSettled = true;
    ticket.resolveResult(value);
  }

  markUnconfirmed(reason) {
    for (const ticket of this.queue.splice(0)) {
      this.counts.unconfirmed += 1;
      this.resolve(ticket, { status: "unconfirmed", id: ticket.id, reason });
    }
    if (this.inFlight) {
      this.counts.unconfirmed += 1;
      this.resolve(this.inFlight, { status: "unconfirmed", id: this.inFlight.id, reason });
    }
  }

  waitForDrain() {
    if (this.pendingCount() === 0) {
      return { promise: Promise.resolve(), cancel() {} };
    }
    const waiter = { active: true, resolve: null };
    waiter.promise = new Promise((resolve) => { waiter.resolve = resolve; });
    this.drainWaiters.push(waiter);
    return {
      promise: waiter.promise,
      cancel: () => {
        if (!waiter.active) return;
        waiter.active = false;
        const index = this.drainWaiters.indexOf(waiter);
        if (index !== -1) this.drainWaiters.splice(index, 1);
      },
    };
  }

  notifyDrain() {
    if (this.pendingCount() !== 0) return;
    const waiters = this.drainWaiters.splice(0);
    for (const waiter of waiters) {
      waiter.active = false;
      waiter.resolve();
    }
  }
}

export default HippocampusQueue;
