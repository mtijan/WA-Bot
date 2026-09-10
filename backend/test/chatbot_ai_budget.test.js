import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getTestAgent } from './helpers/test_app.js';

async function loadBudgetDependencies() {
  await getTestAgent();
  const [{ dbGet, dbRun, dbPath }, budgetService] = await Promise.all([
    import('../src/database.js'),
    import('../src/services/chatbot_ai_budget.service.js')
  ]);
  return { dbGet, dbRun, dbPath, ...budgetService };
}

describe('Chatbot AI atomic budget guard', () => {
  it('reserves and settles one attempt idempotently', async () => {
    const { dbGet, dbPath, reserveAIBudget, settleAIBudget } = await loadBudgetDependencies();
    const input = {
      attemptId: 'budget-settle-attempt',
      userId: 1,
      budgetDay: '2099-01-01',
      limitMicrousd: 1000,
      reservedMicrousd: 300,
      databasePath: dbPath
    };

    const firstReservation = await reserveAIBudget(input);
    const repeatedReservation = await reserveAIBudget(input);
    assert.equal(firstReservation.idempotent, false);
    assert.equal(repeatedReservation.idempotent, true);

    const firstSettlement = await settleAIBudget({
      attemptId: input.attemptId,
      actualCostMicrousd: 200,
      databasePath: dbPath
    });
    const repeatedSettlement = await settleAIBudget({
      attemptId: input.attemptId,
      actualCostMicrousd: 200,
      databasePath: dbPath
    });
    assert.equal(firstSettlement.idempotent, false);
    assert.equal(repeatedSettlement.idempotent, true);

    const daily = await dbGet(
      'SELECT spent_microusd, reserved_microusd FROM chatbot_ai_budget_daily WHERE user_id = ? AND budget_day = ?',
      [1, input.budgetDay]
    );
    assert.deepEqual(daily, { spent_microusd: 200, reserved_microusd: 0 });
  });

  it('retains an UNKNOWN reservation conservatively and permits later reconciliation', async () => {
    const {
      dbGet,
      dbPath,
      markAIBudgetUnknown,
      releaseAIBudget,
      reserveAIBudget,
      settleAIBudget
    } = await loadBudgetDependencies();
    const attemptId = 'budget-unknown-attempt';
    const budgetDay = '2099-01-02';
    await reserveAIBudget({
      attemptId,
      userId: 1,
      budgetDay,
      limitMicrousd: 1000,
      reservedMicrousd: 300,
      databasePath: dbPath
    });

    assert.equal((await markAIBudgetUnknown({ attemptId, databasePath: dbPath })).idempotent, false);
    assert.equal((await markAIBudgetUnknown({ attemptId, databasePath: dbPath })).idempotent, true);
    await assert.rejects(
      releaseAIBudget({ attemptId, databasePath: dbPath }),
      (error) => error.code === 'AI_BUDGET_RELEASE_UNSAFE'
    );

    let daily = await dbGet(
      'SELECT spent_microusd, reserved_microusd FROM chatbot_ai_budget_daily WHERE user_id = ? AND budget_day = ?',
      [1, budgetDay]
    );
    assert.deepEqual(daily, { spent_microusd: 0, reserved_microusd: 300 });

    await settleAIBudget({ attemptId, actualCostMicrousd: 250, databasePath: dbPath });
    daily = await dbGet(
      'SELECT spent_microusd, reserved_microusd FROM chatbot_ai_budget_daily WHERE user_id = ? AND budget_day = ?',
      [1, budgetDay]
    );
    assert.deepEqual(daily, { spent_microusd: 250, reserved_microusd: 0 });
  });

  it('allows only one concurrent reservation when two processes compete for the same balance', async () => {
    const { dbGet, dbPath, reserveAIBudget } = await loadBudgetDependencies();
    const budgetDay = '2099-01-03';
    const common = {
      userId: 1,
      budgetDay,
      limitMicrousd: 100,
      reservedMicrousd: 60,
      databasePath: dbPath
    };

    const results = await Promise.allSettled([
      reserveAIBudget({ ...common, attemptId: 'budget-race-attempt-a' }),
      reserveAIBudget({ ...common, attemptId: 'budget-race-attempt-b' })
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'AI_BUDGET_EXCEEDED');

    const daily = await dbGet(
      'SELECT spent_microusd, reserved_microusd FROM chatbot_ai_budget_daily WHERE user_id = ? AND budget_day = ?',
      [1, budgetDay]
    );
    assert.deepEqual(daily, { spent_microusd: 0, reserved_microusd: 60 });
  });

  it('counts retries as separate attempts and derives budget days at UTC midnight', async () => {
    const { dbGet, dbPath, getUtcBudgetDay, reserveAIBudget } = await loadBudgetDependencies();
    assert.equal(getUtcBudgetDay('2026-09-09T23:59:59.999Z'), '2026-09-09');
    assert.equal(getUtcBudgetDay('2026-09-10T00:00:00.000Z'), '2026-09-10');

    const budgetDay = '2099-01-04';
    for (const attemptId of ['budget-retry-attempt-1', 'budget-retry-attempt-2']) {
      await reserveAIBudget({
        attemptId,
        userId: 1,
        budgetDay,
        limitMicrousd: 500,
        reservedMicrousd: 100,
        databasePath: dbPath
      });
    }
    const daily = await dbGet(
      'SELECT reserved_microusd FROM chatbot_ai_budget_daily WHERE user_id = ? AND budget_day = ?',
      [1, budgetDay]
    );
    assert.equal(daily.reserved_microusd, 200);
  });

  it('moves expired reservations to UNKNOWN and opens the persisted failure circuit', async () => {
    const {
      assertAICircuitClosed,
      dbGet,
      dbPath,
      dbRun,
      markExpiredAIBudgetReservationsUnknown,
      reserveAIBudget
    } = await loadBudgetDependencies();
    const attemptId = 'budget-expired-attempt';
    const budgetDay = '2099-01-05';
    await reserveAIBudget({
      attemptId,
      userId: 1,
      budgetDay,
      limitMicrousd: 1000,
      reservedMicrousd: 100,
      expiresAt: '2020-01-01T00:00:00.000Z',
      databasePath: dbPath
    });
    await markExpiredAIBudgetReservationsUnknown({ databasePath: dbPath });

    const reservation = await dbGet(
      'SELECT status FROM chatbot_ai_budget_reservations WHERE attempt_id = ?',
      [attemptId]
    );
    const daily = await dbGet(
      'SELECT reserved_microusd FROM chatbot_ai_budget_daily WHERE user_id = ? AND budget_day = ?',
      [1, budgetDay]
    );
    assert.equal(reservation.status, 'UNKNOWN');
    assert.equal(daily.reserved_microusd, 100);

    const provider = 'budget-circuit.example';
    for (const requestId of ['circuit-failure-1', 'circuit-failure-2', 'circuit-failure-3']) {
      await dbRun(
        `INSERT INTO chatbot_ai_usage (
           user_id, request_id, request_kind, operation, provider, request_status
         ) VALUES (?, ?, 'production', 'chat', ?, 'FAILED')`,
        [1, requestId, provider]
      );
    }
    await assert.rejects(
      assertAICircuitClosed({ userId: 1, provider, failureThreshold: 3, windowSeconds: 3600 }),
      (error) => error.code === 'AI_CIRCUIT_OPEN'
    );

    await dbRun(
      `INSERT INTO chatbot_ai_usage (
         user_id, request_id, request_kind, operation, provider, request_status
       ) VALUES (?, ?, 'production', 'chat', ?, 'SUCCEEDED')`,
      [1, 'circuit-success', provider]
    );
    const circuit = await assertAICircuitClosed({
      userId: 1,
      provider,
      failureThreshold: 3,
      windowSeconds: 3600
    });
    assert.equal(circuit.enabled, true);
  });
});
