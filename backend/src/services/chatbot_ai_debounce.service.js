import { logger } from '../logger.js';

export class InboundDebouncer {
  constructor() {
    this.pending = new Map();
  }

  getPendingKey(sessionId, senderJid) {
    return `${sessionId}:${senderJid}`;
  }

  hasPending(sessionId, senderJid) {
    return this.pending.has(this.getPendingKey(sessionId, senderJid));
  }

  getPendingText(sessionId, senderJid) {
    return this.pending.get(this.getPendingKey(sessionId, senderJid))?.text || null;
  }

  debounce({
    sessionId,
    senderJid,
    text,
    debounceMs = 0,
    onFlush
  }) {
    if (!sessionId || !senderJid) {
      throw new Error('sessionId and senderJid are required for debouncing.');
    }
    if (typeof onFlush !== 'function') {
      throw new Error('onFlush must be a function.');
    }

    const safeText = String(text || '').trim();
    if (!safeText) return;

    const key = this.getPendingKey(sessionId, senderJid);
    const delay = Math.max(0, Math.min(Number(debounceMs) || 0, 60_000));

    if (delay === 0) {
      onFlush(safeText);
      return;
    }

    const existing = this.pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      const combinedText = `${existing.text}\n${safeText}`;
      existing.text = combinedText;
      existing.timer = setTimeout(() => {
        this.pending.delete(key);
        try {
          onFlush(combinedText);
        } catch (err) {
          logger.error({ err, sessionId, senderJid }, 'Error executing debounced flush callback');
        }
      }, delay);
    } else {
      const entry = {
        text: safeText,
        timer: setTimeout(() => {
          this.pending.delete(key);
          try {
            onFlush(safeText);
          } catch (err) {
            logger.error({ err, sessionId, senderJid }, 'Error executing debounced flush callback');
          }
        }, delay)
      };
      this.pending.set(key, entry);
    }
  }

  cancel(sessionId, senderJid) {
    const key = this.getPendingKey(sessionId, senderJid);
    const existing = this.pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      this.pending.delete(key);
      return true;
    }
    return false;
  }

  flushImmediately(sessionId, senderJid) {
    const key = this.getPendingKey(sessionId, senderJid);
    const existing = this.pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      this.pending.delete(key);
      return existing.text;
    }
    return null;
  }

  clearAll() {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
  }
}

export class SenderRequestSerializer {
  constructor() {
    this.chains = new Map();
  }

  getKey(sessionId, senderJid) {
    return `${sessionId}:${senderJid}`;
  }

  isBusy(sessionId, senderJid) {
    return this.chains.has(this.getKey(sessionId, senderJid));
  }

  enqueue(sessionId, senderJid, taskFn) {
    if (!sessionId || !senderJid) {
      throw new Error('sessionId and senderJid are required for request serialization.');
    }
    if (typeof taskFn !== 'function') {
      throw new Error('taskFn must be a function.');
    }

    const key = this.getKey(sessionId, senderJid);
    const previousPromise = (this.chains.get(key) || Promise.resolve()).catch(() => {});

    let taskResult;
    let taskError;

    const currentPromise = previousPromise
      .then(async () => {
        try {
          taskResult = await taskFn();
        } catch (err) {
          taskError = err;
        }
      })
      .finally(() => {
        if (this.chains.get(key) === currentPromise) {
          this.chains.delete(key);
        }
      })
      .then(() => {
        if (taskError) {
          throw taskError;
        }
        return taskResult;
      });

    this.chains.set(key, currentPromise);
    return currentPromise;
  }

  clearAll() {
    this.chains.clear();
  }
}

export const defaultInboundDebouncer = new InboundDebouncer();
export const defaultSenderSerializer = new SenderRequestSerializer();
