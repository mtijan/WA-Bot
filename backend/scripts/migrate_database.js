const skipBackup = process.argv.includes('--no-backup');

if (!skipBackup) {
  console.log('[DB Migrate] Creating runtime backup before migration...');
  await import('./backup_runtime_data.js');
} else {
  console.warn('[DB Migrate] Backup skipped by --no-backup. Use only for local disposable databases.');
}

const { default: db, databaseReady, dbAll } = await import('../src/database.js');

try {
  await databaseReady;
  const rows = await dbAll('SELECT id, description, applied_at FROM schema_migrations ORDER BY applied_at, id');

  console.log('[DB Migrate] Database is ready.');
  console.log(`[DB Migrate] Applied migrations: ${rows.length}`);
  for (const row of rows) {
    console.log(`  - ${row.id} (${row.applied_at}) ${row.description}`);
  }
} finally {
  db.close();
}
