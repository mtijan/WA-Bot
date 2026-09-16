import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { getTestAgent, cleanupTestDb } from './helpers/test_app.js';
import { dbRun, dbGet, dbAll } from '../src/database.js';
import fs from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const testWorkspaceRoot = join(__dirname, 'helpers', 'tmp-workspace');
const testBackupDir = join(__dirname, 'helpers', 'tmp-backups');

before(() => {
  fs.mkdirSync(testWorkspaceRoot, { recursive: true });
  fs.mkdirSync(testBackupDir, { recursive: true });
});

after(() => {
  cleanupTestDb();
  try {
    fs.rmSync(testWorkspaceRoot, { recursive: true, force: true });
    fs.rmSync(testBackupDir, { recursive: true, force: true });
  } catch (err) {
    // Ignore cleanup error if directories are locked
  }
});

describe('Log and File Pruning Script', () => {
  it('seharusnya memangkas logs database dan file ekspor/backup yang sudah usang', async () => {
    const agent = await getTestAgent(); // Menginisialisasi database test

    // 1. Setup dummy data di database
    // Buat parent campaigns
    await dbRun(`INSERT INTO campaigns (id, message, status) VALUES (1, 'Halo', 'COMPLETED')`);
    await dbRun(`INSERT INTO warmer_campaigns (id, name, device_ids, messages, min_delay, max_delay, duration, status) VALUES (1, 'Warmer Test', 's1', 'hai', 1, 2, 5, 'COMPLETED')`);

    // Masukkan data baru (created_at = sekarang)
    await dbRun(`INSERT INTO delivery_logs (campaign_id, target_number, status, created_at) VALUES (1, '628123', 'SENT', datetime('now'))`);
    await dbRun(`INSERT INTO warmer_logs (campaign_id, sender_session, receiver_session, message, status, created_at) VALUES (1, 's1', 's2', 'halo', 'SUCCESS', datetime('now'))`);
    
    // Masukkan data usang (created_at = 35 hari yang lalu)
    await dbRun(`INSERT INTO delivery_logs (campaign_id, target_number, status, created_at) VALUES (1, '628999', 'FAILED', datetime('now', '-35 days'))`);
    await dbRun(`INSERT INTO warmer_logs (campaign_id, sender_session, receiver_session, message, status, created_at) VALUES (1, 's1', 's2', 'kuno', 'FAILED', datetime('now', '-35 days'))`);

    // Data RAG: cache expired, usage >30 hari, dan terminal job >7 hari harus dipangkas.
    await dbRun(`INSERT INTO sessions (session_id, status, user_id) VALUES ('rag-prune-session', 'CONNECTED', 1)`);
    await dbRun(`INSERT INTO rag_sources (
      id, user_id, source_type, manual_session_id, content_hash, current_revision,
      indexed_revision, lexical_status, embedding_status, is_active
    ) VALUES (9901, 1, 'manual', 'rag-prune-session', 'rag-prune', 1, 1, 'READY', 'DISABLED', 1)`);
    await dbRun(`INSERT INTO rag_response_cache (
      user_id, session_id, cache_key, source_revision_digest, response_ciphertext, expires_at, created_at
    ) VALUES
      (1, 'rag-prune-session', 'expired-cache', 'rev-1', X'00', datetime('now', '-1 day'), datetime('now', '-2 days')),
      (1, 'rag-prune-session', 'active-cache', 'rev-1', X'01', datetime('now', '+1 day'), datetime('now'))`);
    await dbRun(`INSERT INTO chatbot_ai_usage (
      user_id, session_id, request_id, attempt_no, request_kind, operation, request_status, delivery_status, created_at
    ) VALUES
      (1, 'rag-prune-session', 'old-usage', 1, 'production', 'chat', 'SUCCEEDED', 'SENT', datetime('now', '-31 days')),
      (1, 'rag-prune-session', 'new-usage', 1, 'production', 'chat', 'SUCCEEDED', 'SENT', datetime('now'))`);
    await dbRun(`INSERT INTO rag_index_jobs (
      source_id, user_id, requested_revision, embedding_config_hash, status, attempts, created_at, updated_at
    ) VALUES
      (9901, 1, 1, 'old-job', 'FAILED', 1, datetime('now', '-8 days'), datetime('now', '-8 days')),
      (9901, 1, 1, 'new-job', 'READY', 1, datetime('now'), datetime('now'))`);

    // 2. Setup dummy files di folder temporary workspace
    const oldExportFile = join(testWorkspaceRoot, 'ExportWAContacts_TestOld_20260501000000.csv');
    const newExportFile = join(testWorkspaceRoot, 'ExportWAContacts_TestNew_20260606000000.csv');
    fs.writeFileSync(oldExportFile, 'phone\n628123');
    fs.writeFileSync(newExportFile, 'phone\n628999');

    // Ubah mtime dari file ekspor yang usang menjadi 35 hari yang lalu
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldExportFile, thirtyFiveDaysAgo, thirtyFiveDaysAgo);

    // 3. Setup dummy folders di folder backups
    const oldBackupFolder = join(testBackupDir, '2026-05-01T00-00-00-000Z');
    const newBackupFolder = join(testBackupDir, '2026-06-06T00-00-00-000Z');
    fs.mkdirSync(oldBackupFolder, { recursive: true });
    fs.mkdirSync(newBackupFolder, { recursive: true });
    
    // Ubah mtime dari folder backup usang menjadi 35 hari yang lalu
    fs.utimesSync(oldBackupFolder, thirtyFiveDaysAgo, thirtyFiveDaysAgo);

    // 4. Jalankan script pruner dengan --apply lewat child_process
    const prunerScriptPath = resolve(__dirname, '..', 'scripts', 'prune_delivery_logs.js');
    
    await new Promise((resolveExec, rejectExec) => {
      exec(`node "${prunerScriptPath}" --apply`, {
        env: {
          ...process.env,
          WA_BOT_DB_PATH: process.env.WA_BOT_DB_PATH,
          WA_BOT_WORKSPACE_ROOT: testWorkspaceRoot,
          WA_BOT_BACKUP_DIR: testBackupDir,
          WA_BOT_LOG_RETENTION_DAYS: '30',
          WA_BOT_AI_USAGE_RETENTION_DAYS: '30',
          WA_BOT_RAG_JOB_RETENTION_DAYS: '7'
        }
      }, (err, stdout, stderr) => {
        if (err) {
          rejectExec(err);
        } else {
          resolveExec(stdout);
        }
      });
    });

    // 5. Verifikasi bahwa logs database usang telah dihapus
    const deliveryLogs = await dbAll("SELECT * FROM delivery_logs");
    const activeDeliveryLogs = deliveryLogs.filter(l => l.target_number === '628123');
    const oldDeliveryLogs = deliveryLogs.filter(l => l.target_number === '628999');
    assert.equal(activeDeliveryLogs.length, 1);
    assert.equal(oldDeliveryLogs.length, 0);

    const warmerLogs = await dbAll("SELECT * FROM warmer_logs");
    const activeWarmerLogs = warmerLogs.filter(l => l.message === 'halo');
    const oldWarmerLogs = warmerLogs.filter(l => l.message === 'kuno');
    assert.equal(activeWarmerLogs.length, 1);
    assert.equal(oldWarmerLogs.length, 0);

    const cacheRows = await dbAll('SELECT cache_key FROM rag_response_cache ORDER BY cache_key');
    assert.deepEqual(cacheRows.map((row) => row.cache_key), ['active-cache']);
    const usageRows = await dbAll('SELECT request_id FROM chatbot_ai_usage ORDER BY request_id');
    assert.deepEqual(usageRows.map((row) => row.request_id), ['new-usage']);
    const jobRows = await dbAll('SELECT embedding_config_hash FROM rag_index_jobs ORDER BY embedding_config_hash');
    assert.deepEqual(jobRows.map((row) => row.embedding_config_hash), ['new-job']);

    // 6. Verifikasi file ekspor usang telah dihapus, file ekspor baru tetap ada
    assert.ok(!fs.existsSync(oldExportFile), 'File ekspor usang harus dihapus');
    assert.ok(fs.existsSync(newExportFile), 'File ekspor baru harus dipertahankan');

    // 7. Verifikasi backup usang telah dihapus, backup baru tetap ada
    assert.ok(!fs.existsSync(oldBackupFolder), 'Folder backup usang harus dihapus');
    assert.ok(fs.existsSync(newBackupFolder), 'Folder backup baru harus dipertahankan');
  });
});
