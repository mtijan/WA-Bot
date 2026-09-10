import sqlite3 from 'sqlite3';
import { config } from '../config.js';
import { databaseReady, dbAll, dbPath } from '../database.js';
import { logError } from '../logger.js';

function createBudgetError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw createBudgetError('AI_BUDGET_INVALID_INPUT', `${field} harus berupa integer positif.`);
  }
  return value;
}

function requireNonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw createBudgetError('AI_BUDGET_INVALID_INPUT', `${field} harus berupa integer non-negatif.`);
  }
  return value;
}

export function getUtcBudgetDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createBudgetError('AI_BUDGET_INVALID_INPUT', 'Tanggal budget tidak valid.');
  }
  return date.toISOString().slice(0, 10);
}

export function getAIBudgetAttemptId(context) {
  if (!context?.requestId || !Number.isInteger(context.attemptNo) || context.attemptNo < 1) {
    throw createBudgetError('AI_BUDGET_INVALID_INPUT', 'Context attempt budget tidak valid.');
  }
  return `${context.requestId}:${context.attemptNo}`;
}

function normalizeBudgetDay(value) {
  if (!value) return getUtcBudgetDay();
  const day = String(value);
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(parsed.getTime()) || getUtcBudgetDay(parsed) !== day) {
    throw createBudgetError('AI_BUDGET_INVALID_INPUT', 'budgetDay harus berupa tanggal UTC YYYY-MM-DD yang valid.');
  }
  return day;
}

function toSqliteUtc(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createBudgetError('AI_BUDGET_INVALID_INPUT', 'Waktu kedaluwarsa reservation tidak valid.');
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function openDatabase(path = dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path, (error) => {
      if (error) reject(error);
      else resolve(db);
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function withImmediateTransaction(work, path = dbPath) {
  await databaseReady;
  const db = await openDatabase(path);
  try {
    await run(db, 'PRAGMA foreign_keys = ON');
    await run(db, 'PRAGMA busy_timeout = 5000');
    await run(db, 'BEGIN IMMEDIATE');
    try {
      const result = await work(db);
      await run(db, 'COMMIT');
      return result;
    } catch (error) {
      await run(db, 'ROLLBACK').catch(() => {});
      throw error;
    }
  } finally {
    await close(db);
  }
}

export async function reserveAIBudget({
  attemptId,
  userId,
  limitMicrousd,
  reservedMicrousd,
  budgetDay,
  expiresAt = new Date(Date.now() + config.aiBudget.reservationTtlSeconds * 1000),
  databasePath = dbPath
}) {
  if (!attemptId || typeof attemptId !== 'string') {
    throw createBudgetError('AI_BUDGET_INVALID_INPUT', 'attemptId wajib diisi.');
  }
  requirePositiveInteger(userId, 'userId');
  requireNonNegativeInteger(limitMicrousd, 'limitMicrousd');
  requirePositiveInteger(reservedMicrousd, 'reservedMicrousd');
  const day = normalizeBudgetDay(budgetDay);
  const expiry = toSqliteUtc(expiresAt);

  return withImmediateTransaction(async (db) => {
    const existing = await get(
      db,
      'SELECT * FROM chatbot_ai_budget_reservations WHERE attempt_id = ?',
      [attemptId]
    );
    if (existing) {
      if (
        existing.user_id !== userId
        || existing.budget_day !== day
        || existing.reserved_microusd !== reservedMicrousd
      ) {
        throw createBudgetError('AI_BUDGET_ATTEMPT_CONFLICT', 'attemptId sudah dipakai oleh reservation berbeda.');
      }
      return { ...existing, idempotent: true };
    }

    await run(
      db,
      `INSERT INTO chatbot_ai_budget_daily (
         user_id, budget_day, limit_microusd, spent_microusd, reserved_microusd
       ) VALUES (?, ?, ?, 0, 0)
       ON CONFLICT(user_id, budget_day) DO UPDATE SET
         limit_microusd = excluded.limit_microusd,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, day, limitMicrousd]
    );

    const reservationUpdate = await run(
      db,
      `UPDATE chatbot_ai_budget_daily
       SET reserved_microusd = reserved_microusd + ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND budget_day = ?
         AND spent_microusd + reserved_microusd + ? <= limit_microusd`,
      [reservedMicrousd, userId, day, reservedMicrousd]
    );
    if (reservationUpdate.changes !== 1) {
      const snapshot = await get(
        db,
        'SELECT limit_microusd, spent_microusd, reserved_microusd FROM chatbot_ai_budget_daily WHERE user_id = ? AND budget_day = ?',
        [userId, day]
      );
      throw createBudgetError('AI_BUDGET_EXCEEDED', 'Budget harian Chatbot AI tidak mencukupi.', snapshot);
    }

    await run(
      db,
      `INSERT INTO chatbot_ai_budget_reservations (
         attempt_id, user_id, budget_day, reserved_microusd, status, expires_at
       ) VALUES (?, ?, ?, ?, 'RESERVED', ?)`,
      [attemptId, userId, day, reservedMicrousd, expiry]
    );

    return {
      attempt_id: attemptId,
      user_id: userId,
      budget_day: day,
      reserved_microusd: reservedMicrousd,
      status: 'RESERVED',
      expires_at: expiry,
      idempotent: false
    };
  }, databasePath);
}

export async function settleAIBudget({ attemptId, actualCostMicrousd, databasePath = dbPath }) {
  requireNonNegativeInteger(actualCostMicrousd, 'actualCostMicrousd');
  return withImmediateTransaction(async (db) => {
    const reservation = await get(
      db,
      'SELECT * FROM chatbot_ai_budget_reservations WHERE attempt_id = ?',
      [attemptId]
    );
    if (!reservation) {
      throw createBudgetError('AI_BUDGET_RESERVATION_NOT_FOUND', 'Reservation budget tidak ditemukan.');
    }
    if (reservation.status === 'SETTLED') {
      if (reservation.settled_cost_microusd !== actualCostMicrousd) {
        throw createBudgetError('AI_BUDGET_SETTLEMENT_CONFLICT', 'Reservation sudah diselesaikan dengan biaya berbeda.');
      }
      return { ...reservation, idempotent: true };
    }
    if (reservation.status === 'RELEASED') {
      throw createBudgetError('AI_BUDGET_RESERVATION_RELEASED', 'Reservation yang sudah dilepas tidak dapat diselesaikan.');
    }

    const dailyUpdate = await run(
      db,
      `UPDATE chatbot_ai_budget_daily
       SET reserved_microusd = reserved_microusd - ?,
           spent_microusd = spent_microusd + ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND budget_day = ? AND reserved_microusd >= ?`,
      [
        reservation.reserved_microusd,
        actualCostMicrousd,
        reservation.user_id,
        reservation.budget_day,
        reservation.reserved_microusd
      ]
    );
    if (dailyUpdate.changes !== 1) {
      throw createBudgetError('AI_BUDGET_LEDGER_INCONSISTENT', 'Ledger budget tidak konsisten saat settlement.');
    }

    await run(
      db,
      `UPDATE chatbot_ai_budget_reservations
       SET status = 'SETTLED', settled_cost_microusd = ?, updated_at = CURRENT_TIMESTAMP
       WHERE attempt_id = ?`,
      [actualCostMicrousd, attemptId]
    );
    return { ...reservation, status: 'SETTLED', settled_cost_microusd: actualCostMicrousd, idempotent: false };
  }, databasePath);
}

export async function markAIBudgetUnknown({ attemptId, databasePath = dbPath }) {
  return withImmediateTransaction(async (db) => {
    const reservation = await get(
      db,
      'SELECT * FROM chatbot_ai_budget_reservations WHERE attempt_id = ?',
      [attemptId]
    );
    if (!reservation) {
      throw createBudgetError('AI_BUDGET_RESERVATION_NOT_FOUND', 'Reservation budget tidak ditemukan.');
    }
    if (reservation.status === 'RESERVED') {
      await run(
        db,
        `UPDATE chatbot_ai_budget_reservations
         SET status = 'UNKNOWN', updated_at = CURRENT_TIMESTAMP
         WHERE attempt_id = ?`,
        [attemptId]
      );
      return { ...reservation, status: 'UNKNOWN', idempotent: false };
    }
    return { ...reservation, idempotent: true };
  }, databasePath);
}

export async function releaseAIBudget({ attemptId, databasePath = dbPath }) {
  return withImmediateTransaction(async (db) => {
    const reservation = await get(
      db,
      'SELECT * FROM chatbot_ai_budget_reservations WHERE attempt_id = ?',
      [attemptId]
    );
    if (!reservation) {
      throw createBudgetError('AI_BUDGET_RESERVATION_NOT_FOUND', 'Reservation budget tidak ditemukan.');
    }
    if (reservation.status === 'RELEASED') return { ...reservation, idempotent: true };
    if (reservation.status !== 'RESERVED') {
      throw createBudgetError('AI_BUDGET_RELEASE_UNSAFE', 'Hanya reservation RESERVED yang boleh dilepas otomatis.');
    }

    const dailyUpdate = await run(
      db,
      `UPDATE chatbot_ai_budget_daily
       SET reserved_microusd = reserved_microusd - ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND budget_day = ? AND reserved_microusd >= ?`,
      [reservation.reserved_microusd, reservation.user_id, reservation.budget_day, reservation.reserved_microusd]
    );
    if (dailyUpdate.changes !== 1) {
      throw createBudgetError('AI_BUDGET_LEDGER_INCONSISTENT', 'Ledger budget tidak konsisten saat release.');
    }
    await run(
      db,
      `UPDATE chatbot_ai_budget_reservations
       SET status = 'RELEASED', updated_at = CURRENT_TIMESTAMP
       WHERE attempt_id = ?`,
      [attemptId]
    );
    return { ...reservation, status: 'RELEASED', idempotent: false };
  }, databasePath);
}

export async function markExpiredAIBudgetReservationsUnknown({ databasePath = dbPath } = {}) {
  return withImmediateTransaction(async (db) => run(
    db,
    `UPDATE chatbot_ai_budget_reservations
     SET status = 'UNKNOWN', updated_at = CURRENT_TIMESTAMP
     WHERE status = 'RESERVED' AND expires_at <= CURRENT_TIMESTAMP`
  ), databasePath);
}

export async function assertAICircuitClosed({
  userId,
  provider,
  failureThreshold = config.aiBudget.circuitFailureThreshold,
  windowSeconds = config.aiBudget.circuitWindowSeconds
}) {
  if (failureThreshold === 0) return { enabled: false };
  requirePositiveInteger(userId, 'userId');
  requirePositiveInteger(failureThreshold, 'failureThreshold');
  requirePositiveInteger(windowSeconds, 'windowSeconds');

  const rows = await dbAll(
    `SELECT request_status
     FROM chatbot_ai_usage
     WHERE user_id = ? AND provider = ? AND operation = 'chat'
       AND created_at >= datetime('now', ?)
     ORDER BY id DESC
     LIMIT ?`,
    [userId, provider, `-${windowSeconds} seconds`, failureThreshold]
  );
  if (
    rows.length >= failureThreshold
    && rows.every((row) => row.request_status === 'FAILED')
  ) {
    throw createBudgetError('AI_CIRCUIT_OPEN', 'Circuit breaker Chatbot AI sedang terbuka.', {
      failureThreshold,
      windowSeconds
    });
  }
  return { enabled: true, failures: rows.filter((row) => row.request_status === 'FAILED').length };
}

export async function guardAIProviderAttempt({
  context,
  userId,
  provider,
  dailyLimitMicrousd = config.aiBudget.dailyLimitMicrousd,
  reservationMicrousd = config.aiBudget.attemptReservationMicrousd,
  reservationTtlSeconds = config.aiBudget.reservationTtlSeconds
}) {
  await assertAICircuitClosed({ userId, provider });

  const budgetFieldsConfigured = [dailyLimitMicrousd, reservationMicrousd].filter((value) => value > 0).length;
  if (budgetFieldsConfigured === 0) return { budgetEnabled: false, reservation: null };
  if (budgetFieldsConfigured !== 2) {
    throw createBudgetError(
      'AI_BUDGET_CONFIG_INVALID',
      'Daily limit dan attempt reservation wajib dikonfigurasi bersama.'
    );
  }

  await markExpiredAIBudgetReservationsUnknown();
  const reservation = await reserveAIBudget({
    attemptId: getAIBudgetAttemptId(context),
    userId,
    limitMicrousd: dailyLimitMicrousd,
    reservedMicrousd: reservationMicrousd,
    expiresAt: new Date(Date.now() + reservationTtlSeconds * 1000)
  });
  return { budgetEnabled: true, reservation };
}

export async function finalizeAIBudgetSafely({ reservation, responseReceived, error }) {
  if (!reservation) return true;
  try {
    if (responseReceived) {
      await settleAIBudget({
        attemptId: reservation.attempt_id,
        actualCostMicrousd: reservation.reserved_microusd
      });
    } else if (!error?.status || error.status === 429 || error.status >= 500) {
      await markAIBudgetUnknown({ attemptId: reservation.attempt_id });
    } else {
      await releaseAIBudget({ attemptId: reservation.attempt_id });
    }
    return true;
  } catch (budgetError) {
    logError('finalizeAIBudget', budgetError, { attemptId: reservation.attempt_id });
    return false;
  }
}
