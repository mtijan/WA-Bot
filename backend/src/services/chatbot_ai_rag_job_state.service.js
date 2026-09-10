export const RAG_INDEX_JOB_STATES = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  READY: 'READY',
  FAILED: 'FAILED',
  SUPERSEDED: 'SUPERSEDED'
});

export const RAG_LEXICAL_STATES = Object.freeze({
  PENDING: 'PENDING',
  READY: 'READY',
  FAILED: 'FAILED',
  STALE: 'STALE'
});

export const RAG_EMBEDDING_STATES = Object.freeze({
  DISABLED: 'DISABLED',
  PENDING: 'PENDING',
  READY: 'READY',
  FAILED: 'FAILED',
  STALE: 'STALE'
});

const JOB_TRANSITIONS = Object.freeze({
  [RAG_INDEX_JOB_STATES.PENDING]: new Set([
    RAG_INDEX_JOB_STATES.RUNNING,
    RAG_INDEX_JOB_STATES.SUPERSEDED
  ]),
  [RAG_INDEX_JOB_STATES.RUNNING]: new Set([
    RAG_INDEX_JOB_STATES.PENDING,
    RAG_INDEX_JOB_STATES.READY,
    RAG_INDEX_JOB_STATES.FAILED,
    RAG_INDEX_JOB_STATES.SUPERSEDED
  ]),
  [RAG_INDEX_JOB_STATES.FAILED]: new Set([
    RAG_INDEX_JOB_STATES.PENDING,
    RAG_INDEX_JOB_STATES.SUPERSEDED
  ]),
  [RAG_INDEX_JOB_STATES.READY]: new Set(),
  [RAG_INDEX_JOB_STATES.SUPERSEDED]: new Set()
});

export function isRagIndexJobState(value) {
  return Object.values(RAG_INDEX_JOB_STATES).includes(value);
}

export function canTransitionRagIndexJobState(fromState, toState) {
  if (!isRagIndexJobState(fromState) || !isRagIndexJobState(toState)) return false;
  return JOB_TRANSITIONS[fromState].has(toState);
}

export function assertRagIndexJobTransition(fromState, toState) {
  if (!canTransitionRagIndexJobState(fromState, toState)) {
    const error = new Error(`Transisi state job RAG tidak valid: ${fromState} -> ${toState}.`);
    error.code = 'RAG_INDEX_JOB_INVALID_TRANSITION';
    error.details = { fromState, toState };
    throw error;
  }
  return toState;
}
