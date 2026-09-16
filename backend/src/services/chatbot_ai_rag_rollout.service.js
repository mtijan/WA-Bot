import { createHash } from 'node:crypto';

const REQUIRED_DECISIONS = Object.freeze([
  'DEC-001', 'DEC-002', 'DEC-003', 'DEC-004', 'DEC-005',
  'DEC-006', 'DEC-007', 'DEC-008', 'DEC-009'
]);

const REQUIRED_PILOT_GATES = Object.freeze([
  'quality', 'budget', 'billing', 'retention', 'output_profile',
  'sla', 'real_embedding', 'migration_backup', 'governance'
]);

const ROLLOUT_TRANSITIONS = Object.freeze({
  25: 50,
  50: 100
});

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

export function evaluateRagRolloutAdvance({
  currentPercentage,
  targetPercentage,
  preflightReady = false,
  observation = null
} = {}) {
  const current = Number(currentPercentage);
  const target = Number(targetPercentage);
  const blockers = [];
  if (ROLLOUT_TRANSITIONS[current] !== target) blockers.push('invalid_transition');
  if (preflightReady !== true) blockers.push('preflight');
  if (observation?.ready !== true) blockers.push('observation');
  if (Array.isArray(observation?.blockers) && observation.blockers.length > 0) {
    blockers.push('observation_blockers');
  }
  return Object.freeze({
    ready: blockers.length === 0,
    blockers: Object.freeze(blockers),
    current_percentage: Number.isFinite(current) ? current : null,
    target_percentage: Number.isFinite(target) ? target : null,
    required_target_percentage: ROLLOUT_TRANSITIONS[current] ?? null
  });
}

export function planRagRollback({
  sessionIds,
  lexicalReadySessionIds = [],
  reason = 'operator_requested'
} = {}) {
  const sessions = normalizeSessionIds(sessionIds, 'sessionIds');
  const lexicalReady = new Set(normalizeSessionIds(
    lexicalReadySessionIds,
    'lexicalReadySessionIds'
  ));
  const unknownReady = [...lexicalReady].filter((sessionId) => !sessions.includes(sessionId));
  if (unknownReady.length > 0) {
    throw rolloutError(
      'RAG_ROLLOUT_UNKNOWN_SESSION',
      'Sesi lexical-ready harus termasuk target rollback.'
    );
  }
  const safeReason = String(reason || '').trim();
  if (!safeReason) {
    throw rolloutError('RAG_ROLLOUT_INVALID_INPUT', 'reason rollback wajib diisi.');
  }
  const actions = sessions.map((sessionId) => Object.freeze({
    session_id: sessionId,
    mode: lexicalReady.has(sessionId) ? 'fts' : 'cs',
    hybrid_enabled: false,
    cache_enabled: false,
    full_kb_enabled: false,
    delete_data: false
  }));
  return Object.freeze({
    reason: safeReason,
    target_count: sessions.length,
    fts_count: actions.filter((action) => action.mode === 'fts').length,
    cs_count: actions.filter((action) => action.mode === 'cs').length,
    pause_index_jobs: true,
    delete_sources: false,
    delete_sessions: false,
    actions: Object.freeze(actions)
  });
}

export function evaluateLegacyFullKbRetirement({
  rolloutPercentage,
  rollbackWindowEnded = false,
  rollbackValidated = false,
  stagingReady = false,
  activeLegacyExemptions = []
} = {}) {
  const exemptions = normalizeSessionIds(activeLegacyExemptions, 'activeLegacyExemptions');
  const blockers = [];
  if (Number(rolloutPercentage) !== 100) blockers.push('rollout_not_complete');
  if (rollbackWindowEnded !== true) blockers.push('rollback_window');
  if (rollbackValidated !== true) blockers.push('rollback_not_validated');
  if (stagingReady !== true) blockers.push('staging_not_ready');
  if (exemptions.length > 0) blockers.push('legacy_exemptions');
  return Object.freeze({
    ready: blockers.length === 0,
    blockers: Object.freeze(blockers),
    rollout_percentage: Number.isFinite(Number(rolloutPercentage))
      ? Number(rolloutPercentage) : null,
    active_legacy_exemptions: Object.freeze(exemptions)
  });
}

export const RAG_ROLLOUT_REQUIREMENTS = Object.freeze({
  decisions: REQUIRED_DECISIONS,
  pilot_gates: REQUIRED_PILOT_GATES,
  minimum_observation_hours: 48,
  minimum_evaluable_answers: 30,
  rollout_transitions: ROLLOUT_TRANSITIONS
});
