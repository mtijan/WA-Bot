const run = (db, sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

const get = (db, sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const all = (db, sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const exec = async (db, statements) => {
  for (const statement of statements) {
    await run(db, statement);
  }
};

const columnExists = async (db, tableName, columnName) => {
  const columns = await all(db, `PRAGMA table_info(${tableName})`);
  return columns.some((column) => column.name === columnName);
};

const addColumnIfMissing = async (db, tableName, columnName, definition) => {
  if (await columnExists(db, tableName, columnName)) return;
  await run(db, `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
};

const migrations = [
  {
    id: '001_initial_application_schema',
    description: 'Create baseline application tables and reconcile legacy inline schema columns.',
    up: async (db) => {
      await exec(db, [
        `CREATE TABLE IF NOT EXISTS sessions (
          session_id TEXT PRIMARY KEY,
          phone_number TEXT,
          status TEXT NOT NULL,
          proxy_url TEXT,
          proxy_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS proxies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          proxy_url TEXT NOT NULL,
          status TEXT DEFAULT 'ACTIVE',
          ip TEXT,
          country TEXT,
          city TEXT,
          isp TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          name TEXT,
          message TEXT NOT NULL,
          status TEXT DEFAULT 'PENDING',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions (session_id)
        )`,
        `CREATE TABLE IF NOT EXISTS delivery_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER,
          target_number TEXT NOT NULL,
          status TEXT DEFAULT 'PENDING',
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (campaign_id) REFERENCES campaigns (id)
        )`,
        `CREATE TABLE IF NOT EXISTS chatbot_flows (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          flow_name TEXT NOT NULL,
          description TEXT,
          session_ids TEXT NOT NULL,
          target_type TEXT DEFAULT 'ALL',
          keywords TEXT NOT NULL,
          match_type TEXT DEFAULT 'CONTAINS',
          case_sensitive INTEGER DEFAULT 0,
          cooldown INTEGER DEFAULT 0,
          delay INTEGER DEFAULT 0,
          nodes TEXT NOT NULL,
          status TEXT DEFAULT 'ACTIVE',
          sent_count INTEGER DEFAULT 0,
          trigger_count INTEGER DEFAULT 0,
          failed_count INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS auto_replies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          keyword TEXT NOT NULL,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          options TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions (session_id)
        )`,
        `CREATE TABLE IF NOT EXISTS contact_groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          color TEXT DEFAULT '#3b82f6',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS message_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          content TEXT NOT NULL,
          type TEXT DEFAULT 'text',
          category TEXT DEFAULT 'General',
          attachment_url TEXT,
          attachment_name TEXT,
          contact_name TEXT,
          contact_number TEXT,
          poll_question TEXT,
          poll_options TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS contacts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          phone_number TEXT NOT NULL,
          email TEXT,
          company TEXT,
          position TEXT,
          notes TEXT,
          tags TEXT,
          status TEXT DEFAULT 'UNVERIFIED',
          var1 TEXT,
          var2 TEXT,
          var3 TEXT,
          var4 TEXT,
          var5 TEXT,
          var6 TEXT,
          var7 TEXT,
          var8 TEXT,
          var9 TEXT,
          var10 TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (group_id) REFERENCES contact_groups (id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS warmer_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          messages TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS warmer_campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          device_ids TEXT NOT NULL,
          template_id INTEGER,
          messages TEXT NOT NULL,
          min_delay INTEGER NOT NULL,
          max_delay INTEGER NOT NULL,
          duration INTEGER NOT NULL,
          status TEXT DEFAULT 'RUNNING',
          sent_count INTEGER DEFAULT 0,
          started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS warmer_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER,
          sender_session TEXT NOT NULL,
          receiver_session TEXT NOT NULL,
          message TEXT NOT NULL,
          status TEXT DEFAULT 'SUCCESS',
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (campaign_id) REFERENCES warmer_campaigns (id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS whatsapp_contacts (
          jid TEXT PRIMARY KEY,
          name TEXT,
          notify TEXT,
          verified_name TEXT,
          lid TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS opt_out_contacts (
          phone_number TEXT PRIMARY KEY,
          source TEXT DEFAULT 'MANUAL',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS chatbot_ai_settings (
          session_id TEXT PRIMARY KEY,
          is_active INTEGER DEFAULT 0,
          base_url TEXT DEFAULT 'https://ai.sumopod.com/v1',
          api_key TEXT,
          model_name TEXT DEFAULT 'glm-5-turbo',
          system_instruction TEXT,
          knowledge_base TEXT,
          delay_seconds INTEGER DEFAULT 2,
          show_typing INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE CASCADE
        )`
      ]);

      await addColumnIfMissing(db, 'chatbot_flows', 'sent_count', 'INTEGER DEFAULT 0');
      await addColumnIfMissing(db, 'chatbot_flows', 'trigger_count', 'INTEGER DEFAULT 0');
      await addColumnIfMissing(db, 'chatbot_flows', 'failed_count', 'INTEGER DEFAULT 0');
      await addColumnIfMissing(db, 'campaigns', 'name', 'TEXT');
      await addColumnIfMissing(db, 'sessions', 'proxy_url', 'TEXT');
      await addColumnIfMissing(db, 'sessions', 'proxy_id', 'INTEGER');
      await addColumnIfMissing(db, 'delivery_logs', 'created_at', 'DATETIME');
      await run(db, 'UPDATE delivery_logs SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL');

      await addColumnIfMissing(db, 'message_templates', 'type', "TEXT DEFAULT 'text'");
      await addColumnIfMissing(db, 'message_templates', 'category', "TEXT DEFAULT 'General'");
      await addColumnIfMissing(db, 'message_templates', 'attachment_url', 'TEXT');
      await addColumnIfMissing(db, 'message_templates', 'attachment_name', 'TEXT');
      await addColumnIfMissing(db, 'message_templates', 'contact_name', 'TEXT');
      await addColumnIfMissing(db, 'message_templates', 'contact_number', 'TEXT');
      await addColumnIfMissing(db, 'message_templates', 'poll_question', 'TEXT');
      await addColumnIfMissing(db, 'message_templates', 'poll_options', 'TEXT');

      await addColumnIfMissing(db, 'whatsapp_contacts', 'created_at', 'DATETIME');
      await run(db, 'UPDATE whatsapp_contacts SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL');

      await addColumnIfMissing(db, 'proxies', 'ip', 'TEXT');
      await addColumnIfMissing(db, 'proxies', 'country', 'TEXT');
      await addColumnIfMissing(db, 'proxies', 'city', 'TEXT');
      await addColumnIfMissing(db, 'proxies', 'isp', 'TEXT');
    }
  },
  {
    id: '002_runtime_indexes_and_sqlite_pragmas',
    description: 'Add indexes for runtime queries and enable SQLite reliability defaults.',
    useTransaction: false,
    up: async (db) => {
      await exec(db, [
        'PRAGMA foreign_keys = ON',
        'PRAGMA journal_mode = WAL',
        'CREATE INDEX IF NOT EXISTS idx_delivery_logs_campaign_id ON delivery_logs (campaign_id)',
        'CREATE INDEX IF NOT EXISTS idx_delivery_logs_status ON delivery_logs (status)',
        'CREATE INDEX IF NOT EXISTS idx_contacts_group_id ON contacts (group_id)',
        'CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status)',
        'CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns (status)',
        'CREATE INDEX IF NOT EXISTS idx_warmer_campaigns_status ON warmer_campaigns (status)',
        'CREATE INDEX IF NOT EXISTS idx_warmer_logs_campaign_id ON warmer_logs (campaign_id)',
        'CREATE INDEX IF NOT EXISTS idx_opt_out_contacts_phone_number ON opt_out_contacts (phone_number)'
      ]);
    }
  },
  {
    id: '003_chatbot_ai_credentials_table',
    description: 'Create chatbot_ai_credentials table and relate to chatbot_ai_settings.',
    up: async (db) => {
      await exec(db, [
        `CREATE TABLE IF NOT EXISTS chatbot_ai_credentials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          base_url TEXT DEFAULT 'https://ai.sumopod.com/v1',
          api_key TEXT,
          model_name TEXT DEFAULT 'glm-5-turbo',
          is_active INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      ]);

      await addColumnIfMissing(db, 'chatbot_ai_settings', 'credential_id', 'INTEGER');

      const oldSettings = await all(db, 'SELECT session_id, base_url, api_key, model_name FROM chatbot_ai_settings');
      for (const row of oldSettings) {
        if (row.api_key) {
          let existingCred = await get(db, 'SELECT id FROM chatbot_ai_credentials WHERE api_key = ? AND base_url = ?', [row.api_key, row.base_url]);
          let credentialId;
          if (existingCred) {
            credentialId = existingCred.id;
          } else {
            const name = `Kredensial Sesi ${row.session_id}`;
            const result = await run(db, 
              `INSERT INTO chatbot_ai_credentials (name, base_url, api_key, model_name, is_active) VALUES (?, ?, ?, ?, 1)`,
              [name, row.base_url, row.api_key, row.model_name]
            );
            credentialId = result.id;
          }
          await run(db, 'UPDATE chatbot_ai_settings SET credential_id = ? WHERE session_id = ?', [credentialId, row.session_id]);
        }
      }
    }
  },
  {
    id: '004_add_knowledge_source_to_settings',
    description: 'Add knowledge_source column to chatbot_ai_settings table.',
    up: async (db) => {
      await addColumnIfMissing(db, 'chatbot_ai_settings', 'knowledge_source', "TEXT DEFAULT 'manual'");
    }
  },
  {
    id: '005_add_chatbot_mode_to_settings',
    description: 'Add chatbot_mode column to chatbot_ai_settings table.',
    up: async (db) => {
      await addColumnIfMissing(db, 'chatbot_ai_settings', 'chatbot_mode', "TEXT DEFAULT 'both'");
    }
  },
  {
    id: '006_chatbot_flow_delivery_metrics',
    description: 'Separate chatbot flow trigger, successful message, and failed message counters.',
    up: async (db) => {
      const hadTriggerCount = await columnExists(db, 'chatbot_flows', 'trigger_count');
      await addColumnIfMissing(db, 'chatbot_flows', 'trigger_count', 'INTEGER DEFAULT 0');
      await addColumnIfMissing(db, 'chatbot_flows', 'failed_count', 'INTEGER DEFAULT 0');

      if (!hadTriggerCount) {
        await run(db, 'UPDATE chatbot_flows SET trigger_count = COALESCE(sent_count, 0)');
        await run(db, 'UPDATE chatbot_flows SET sent_count = 0');
      }
    }
  },
  {
    id: '007_add_campaign_attachments',
    description: 'Add attachment fields (url, type, name) to campaigns table.',
    up: async (db) => {
      await addColumnIfMissing(db, 'campaigns', 'attachment_url', 'TEXT');
      await addColumnIfMissing(db, 'campaigns', 'attachment_type', 'TEXT');
      await addColumnIfMissing(db, 'campaigns', 'attachment_name', 'TEXT');
    }
  },
  {
    id: '008_add_chatbot_ai_error_fields',
    description: 'Add last_error and last_error_at columns to chatbot_ai_settings table.',
    up: async (db) => {
      await addColumnIfMissing(db, 'chatbot_ai_settings', 'last_error', 'TEXT');
      await addColumnIfMissing(db, 'chatbot_ai_settings', 'last_error_at', 'DATETIME');
    }
  }
];

export const runMigrations = async (db, options = {}) => {
  const logger = options.logger || console;

  await run(db, 'PRAGMA foreign_keys = ON');
  await run(db, `CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    description TEXT,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const appliedRows = await all(db, 'SELECT id FROM schema_migrations');
  const applied = new Set(appliedRows.map((row) => row.id));

  let appliedCount = 0;

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    logger.log(`[DB Migrate] Applying ${migration.id}: ${migration.description}`);

    if (migration.useTransaction === false) {
      await migration.up(db);
      await run(db, 'INSERT INTO schema_migrations (id, description) VALUES (?, ?)', [
        migration.id,
        migration.description
      ]);
      appliedCount += 1;
      logger.log(`[DB Migrate] Applied ${migration.id}`);
      continue;
    }

    await run(db, 'BEGIN IMMEDIATE TRANSACTION');
    try {
      await migration.up(db);
      await run(db, 'INSERT INTO schema_migrations (id, description) VALUES (?, ?)', [
        migration.id,
        migration.description
      ]);
      await run(db, 'COMMIT');
      appliedCount += 1;
      logger.log(`[DB Migrate] Applied ${migration.id}`);
    } catch (err) {
      await run(db, 'ROLLBACK').catch(() => {});
      throw err;
    }
  }

  return {
    applied: appliedCount,
    total: migrations.length
  };
};

export const listMigrations = () => migrations.map(({ id, description }) => ({ id, description }));
