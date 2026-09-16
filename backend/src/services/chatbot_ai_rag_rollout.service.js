import { createHash } from 'node:crypto';

const REQUIRED_DECISIONS = Object.freeze([
  'DEC-001', 'DEC-002', 'DEC-003', 'DEC-004', 'DEC-005',
  'DEC-006', 'DEC-007', 'DEC-008', 'DEC-009'
]);

const REQUIRED_PILOT_GATES = Object.freeze([
  'quality', 'budget', 'billing', 'retention', 'output_profile',
  'sla', 'real_embedding', 'migration_backup', 'governance'
]);

function rolloutError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeSessionIds(values, field) {
  if (!Array.isArray(values)) {
    throw rolloutError('RAG_ROLLOUT_INVALID_INPUT', `${field} harus berupa array.`);
  }
  const normalized = values.map((value) => String(value || '').trim());
  if (normalized.some((value) => !value)) {
    throw rolloutError('RAG_ROLLOUT_INVALID_INPUT', `${field} tidak boleh berisi ID kosong.`);
  }
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

function isClosedDecision(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'CLOSED' || normalized === 'DECIDED';
}

function stableSessionScore(sessionId, seed) {
  return createHash('sha256').update(`${seed}:${sessionId}`).digest('hex');
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value) && value >= 0);
  return usable.length === 0
    ? null
    : usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function percentile(values, target) {
  const usable = values.filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (usable.length === 0) return null;
  return usable[Math.max(0, Math.ceil((target / 100) * usable.length) - 1)];
}

export function evaluateRagPilotPreflight({ decisions = {}, gates = {} } = {}) {
  const decisionBlockers = REQUIRED_DECISIONS
    .filter((id) => !isClosedDecision(decisions[id]))
    .map((id) => `decision:${id}`);
  const gateBlockers = REQUIRED_PILOT_GATES
    .filter((gate) => gates[gate] !== true)
    .map((gate) => `gate:${gate}`);
  const blockers = Object.freeze([...decisionBlockers, ...gateBlockers]);
  return Object.freeze({
    ready: blockers.length === 0,
    blockers,
    decisions_closed: REQUIRED_DECISIONS.length - decisionBlockers.length,
    decisions_required: REQUIRED_DECISIONS.length,
    gates_passed: REQUIRED_PILOT_GATES.length - gateBlockers.length,
    gates_required: REQUIRED_PILOT_GATES.length
  });
}

export function evaluateRagPilotObservation({
  startedAt,
  endedAt,
  outcomes = [],
  minimumHours = 48,
  minimumEvaluableAnswers = 30
} = {}) {
  const startedMs = Date.parse(startedAt);
  const endedMs = Date.parse(endedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs) || endedMs < startedMs) {
    throw rolloutError(
      'RAG_ROLLOUT_INVALID_OBSERVATION_WINDOW',
      'Jendela observasi pilot tidak valid.'
    );
  }
  if (!Array.isArray(outcomes)) {
    throw rolloutError('RAG_ROLLOUT_INVALID_INPUT', 'outcomes harus berupa array.');
  }
  const evaluable = outcomes.filter((outcome) => outcome?.evaluable === true);
  const observationHours = (endedMs - startedMs) / 3_600_000;
  const criticalRegressions = outcomes.filter((outcome) => outcome?.critical_regression === true).length;
  const tenantLeaks = outcomes.filter((outcome) => outcome?.tenant_leak === true).length;
  const wrongBusinessFacts = outcomes.filter((outcome) => outcome?.wrong_business_fact === true).length;
  const blockers = [];
  if (observationHours < minimumHours) blockers.push('observation_window');
  if (evaluable.length < minimumEvaluableAnswers) blockers.push('evaluable_answers');
  if (criticalRegressions > 0) blockers.push('critical_regression');
  if (tenantLeaks > 0) blockers.push('tenant_leak');
  if (wrongBusinessFacts > 0) blockers.push('wrong_business_fact');

  return Object.freeze({
    ready: blockers.length === 0,
    blockers: Object.freeze(blockers),
    observation_hours: observationHours,
    minimum_hours: minimumHours,
    total_outcomes: outcomes.length,
    evaluable_answers: evaluable.length,
    minimum_evaluable_answers: minimumEvaluableAnswers,
    critical_regressions: criticalRegressions,
    tenant_leaks: tenantLeaks,
    wrong_business_facts: wrongBusinessFacts,
    input_tokens_average: average(evaluable.map((outcome) => outcome?.input_tokens)),
    output_tokens_average: average(evaluable.map((outcome) => outcome?.output_tokens)),
    cost_usd_total: evaluable.reduce(
      (sum, outcome) => sum + (Number.isFinite(outcome?.cost_usd) ? outcome.cost_usd : 0),
      0
    ),
    latency_p95_ms: percentile(evaluable.map((outcome) => outcome?.latency_ms), 95)
  });
}

export function planRagRolloutCohort({
  eligibleSessionIds,
  percentage = 25,
  seed = 'rag-rollout-v1',
  pilotSessionIds = [],
  previousSessionIds = []
} = {}) {
  const eligible = normalizeSessionIds(eligibleSessionIds, 'eligibleSessionIds');
  const pilots = normalizeSessionIds(pilotSessionIds, 'pilotSessionIds');
  const previous = normalizeSessionIds(previousSessionIds, 'previousSessionIds');
  const safePercentage = Number(percentage);
  if (!Number.isFinite(safePercentage) || safePercentage <= 0 || safePercentage > 100) {
    throw rolloutError(
      'RAG_ROLLOUT_INVALID_PERCENTAGE',
      'percentage harus lebih dari 0 dan maksimal 100.'
    );
  }
  const eligibleSet = new Set(eligible);
  const pinned = [...new Set([...pilots, ...previous])];
  const unknownPinned = pinned.filter((sessionId) => !eligibleSet.has(sessionId));
  if (unknownPinned.length > 0) {
    throw rolloutError(
      'RAG_ROLLOUT_UNKNOWN_SESSION',
      'Pilot atau cohort sebelumnya tidak tersedia pada daftar eligible.'
    );
  }
  const targetCount = eligible.length === 0
    ? 0
    : Math.max(pinned.length, Math.ceil(eligible.length * safePercentage / 100));
  const ranked = eligible
    .filter((sessionId) => !pinned.includes(sessionId))
    .sort((left, right) => stableSessionScore(left, seed).localeCompare(stableSessionScore(right, seed)));
  const selected = [...pinned, ...ranked.slice(0, Math.max(0, targetCount - pinned.length))]
    .sort((left, right) => left.localeCompare(right));

  return Object.freeze({
    percentage: safePercentage,
    eligible_count: eligible.length,
    target_count: targetCount,
    selected_count: selected.length,
    selected_sessions: Object.freeze(selected),
    eligible_digest: createHash('sha256').update(JSON.stringify(eligible)).digest('hex'),
    seed: String(seed)
  });
}

export const RAG_ROLLOUT_REQUIREMENTS = Object.freeze({
  decisions: REQUIRED_DECISIONS,
  pilot_gates: REQUIRED_PILOT_GATES,
  minimum_observation_hours: 48,
  minimum_evaluable_answers: 30
});
