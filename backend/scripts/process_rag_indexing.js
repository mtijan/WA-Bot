import '../src/env.js';
import { logger } from '../src/logger.js';

const { default: db, databaseReady } = await import('../src/database.js');
const { default: ragIndexPollingWorker } = await import(
  '../src/services/chatbot_ai_rag_worker.service.js'
);

try {
  await databaseReady;
  const cycle = await ragIndexPollingWorker.pollOnce();
  const summary = cycle.handler_result || {
    requested_count: 0,
    ready_count: 0,
    failed_count: 0,
    skipped_count: 0,
    chunk_count: 0
  };

  logger.info({
    due_jobs: cycle.jobs.length,
    recovered_leases: cycle.recovery?.recovered_count || 0,
    ...summary,
    results: undefined
  }, 'RAG one-shot indexing completed');

  if (summary.failed_count > 0) process.exitCode = 1;
} catch (error) {
  logger.error(
    { err: { code: error?.code, message: error?.message } },
    'RAG one-shot indexing failed'
  );
  process.exitCode = 1;
} finally {
  db.close();
}
