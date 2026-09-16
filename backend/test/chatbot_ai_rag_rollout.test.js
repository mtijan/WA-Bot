import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateRagPilotObservation,
  evaluateRagPilotPreflight,
  planRagRolloutCohort,
  RAG_ROLLOUT_REQUIREMENTS
} from '../src/services/chatbot_ai_rag_rollout.service.js';

const closedDecisions = Object.fromEntries(
  RAG_ROLLOUT_REQUIREMENTS.decisions.map((id) => [id, 'CLOSED'])
);
const passedGates = Object.fromEntries(
  RAG_ROLLOUT_REQUIREMENTS.pilot_gates.map((id) => [id, true])
);

test('RAG-1003 preflight pilot fail-closed saat keputusan dan gate belum lengkap', () => {
  const result = evaluateRagPilotPreflight({
    decisions: { 'DEC-001': 'DECIDED', 'DEC-007': 'DECIDED' },
    gates: { governance: true }
  });
  assert.equal(result.ready, false);
  assert.equal(result.decisions_closed, 2);
  assert.equal(result.gates_passed, 1);
  assert.ok(result.blockers.includes('decision:DEC-008'));
  assert.ok(result.blockers.includes('gate:billing'));
  assert.ok(result.blockers.includes('gate:sla'));
});

test('RAG-1003 preflight pilot hanya ready saat seluruh keputusan dan gate ditutup', () => {
  const result = evaluateRagPilotPreflight({ decisions: closedDecisions, gates: passedGates });
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
});

test('RAG-1004 observation gate menahan rollout sebelum 48 jam dan 30 jawaban', () => {
  const outcomes = Array.from({ length: 29 }, (_, index) => ({
    evaluable: true,
    input_tokens: 200 + index,
    output_tokens: 40,
    cost_usd: 0.00001,
    latency_ms: 100 + index
  }));
  const result = evaluateRagPilotObservation({
    startedAt: '2026-09-16T00:00:00.000Z',
    endedAt: '2026-09-17T23:00:00.000Z',
    outcomes
  });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('observation_window'));
  assert.ok(result.blockers.includes('evaluable_answers'));
});

test('RAG-1004 observation gate lulus tepat pada 48 jam dan 30 jawaban aman', () => {
  const outcomes = Array.from({ length: 30 }, (_, index) => ({
    evaluable: true,
    input_tokens: 220,
    output_tokens: 48,
    cost_usd: 0.000012,
    latency_ms: 120 + index
  }));
  const result = evaluateRagPilotObservation({
    startedAt: '2026-09-16T00:00:00.000Z',
    endedAt: '2026-09-18T00:00:00.000Z',
    outcomes
  });
  assert.equal(result.ready, true);
  assert.equal(result.observation_hours, 48);
  assert.equal(result.evaluable_answers, 30);
  assert.equal(result.latency_p95_ms, 148);
});

test('RAG-1004 observasi gagal jika ada kebocoran tenant atau fakta bisnis salah', () => {
  const outcomes = Array.from({ length: 30 }, () => ({ evaluable: true }));
  outcomes[0].tenant_leak = true;
  outcomes[1].wrong_business_fact = true;
  const result = evaluateRagPilotObservation({
    startedAt: '2026-09-16T00:00:00.000Z',
    endedAt: '2026-09-18T00:00:00.000Z',
    outcomes
  });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('tenant_leak'));
  assert.ok(result.blockers.includes('wrong_business_fact'));
});

test('RAG-1005 cohort 25 persen deterministik, kumulatif, dan berbasis eligible freeze', () => {
  const eligibleSessionIds = Array.from({ length: 12 }, (_, index) => `session-${index + 1}`);
  const first = planRagRolloutCohort({
    eligibleSessionIds,
    percentage: 25,
    seed: 'release-2026-09',
    pilotSessionIds: ['session-1']
  });
  const second = planRagRolloutCohort({
    eligibleSessionIds: [...eligibleSessionIds].reverse(),
    percentage: 25,
    seed: 'release-2026-09',
    pilotSessionIds: ['session-1']
  });
  assert.equal(first.target_count, 3);
  assert.equal(first.selected_count, 3);
  assert.ok(first.selected_sessions.includes('session-1'));
  assert.deepEqual(first, second);

  const expanded = planRagRolloutCohort({
    eligibleSessionIds,
    percentage: 50,
    seed: 'release-2026-09',
    previousSessionIds: first.selected_sessions
  });
  assert.equal(expanded.selected_count, 6);
  assert.equal(first.selected_sessions.every((id) => expanded.selected_sessions.includes(id)), true);
});
