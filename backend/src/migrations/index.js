import bcrypt from 'bcryptjs';

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
  },
  {
    id: '009_session_repair_and_failed_replies_monitoring',
    description: 'Add disconnected_at to sessions, and create session_repair_logs and chatbot_failed_replies tables.',
    up: async (db) => {
      await addColumnIfMissing(db, 'sessions', 'disconnected_at', 'DATETIME');
      await exec(db, [
        `CREATE TABLE IF NOT EXISTS session_repair_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          status TEXT NOT NULL,
          error_message TEXT,
          downtime_seconds INTEGER,
          triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS chatbot_failed_replies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          phone_number TEXT NOT NULL,
          message_content TEXT,
          triggered_keyword TEXT,
          error_message TEXT,
          status TEXT DEFAULT 'UNRESOLVED',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE CASCADE
        )`
      ]);
      await exec(db, [
        'CREATE INDEX IF NOT EXISTS idx_session_repair_logs_session_id ON session_repair_logs (session_id)',
        'CREATE INDEX IF NOT EXISTS idx_chatbot_failed_replies_session_id ON chatbot_failed_replies (session_id)',
        'CREATE INDEX IF NOT EXISTS idx_chatbot_failed_replies_status ON chatbot_failed_replies (status)'
      ]);
    }
  },
  {
    id: '010_add_trigger_type_to_repair_logs',
    description: 'Add trigger_type column to session_repair_logs table.',
    up: async (db) => {
      await addColumnIfMissing(db, 'session_repair_logs', 'trigger_type', "TEXT DEFAULT 'RECONNECT'");
    }
  },
  {
    id: '011_create_users_table',
    description: 'Create users table and seed initial admin user if configured.',
    up: async (db) => {
      await exec(db, [
        `CREATE TABLE IF NOT EXISTS users (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          username      TEXT    UNIQUE NOT NULL COLLATE NOCASE,
          password_hash TEXT    NOT NULL,
          display_name  TEXT,
          role          TEXT    NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
          is_active     INTEGER NOT NULL DEFAULT 1,
          token_version INTEGER NOT NULL DEFAULT 0,
          password_changed_at DATETIME,
          created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      ]);

      const adminPassword = process.env.WA_BOT_ADMIN_PASSWORD || '';
      const adminUsername = process.env.WA_BOT_ADMIN_USERNAME || 'admin';

      if (adminPassword) {
        const usersCount = await get(db, 'SELECT COUNT(*) as count FROM users');
        if (usersCount.count === 0) {
          const salt = await bcrypt.genSalt(12);
          const hash = await bcrypt.hash(adminPassword, salt);
          await run(db,
            `INSERT INTO users (username, password_hash, display_name, role, is_active) VALUES (?, ?, ?, 'admin', 1)`,
            [adminUsername, hash, 'Administrator']
          );
        }
      }
    }
  },
  {
    id: '012_data_isolation',
    description: 'Add user_id column to core tables and make opt_out_contacts user-specific.',
    up: async (db) => {
      await addColumnIfMissing(db, 'sessions', 'user_id', 'INTEGER DEFAULT 1');
      await addColumnIfMissing(db, 'contact_groups', 'user_id', 'INTEGER DEFAULT 1');
      await addColumnIfMissing(db, 'message_templates', 'user_id', 'INTEGER DEFAULT 1');
      await addColumnIfMissing(db, 'warmer_templates', 'user_id', 'INTEGER DEFAULT 1');
      await addColumnIfMissing(db, 'chatbot_flows', 'user_id', 'INTEGER DEFAULT 1');
      await addColumnIfMissing(db, 'chatbot_ai_credentials', 'user_id', 'INTEGER DEFAULT 1');
      await addColumnIfMissing(db, 'warmer_campaigns', 'user_id', 'INTEGER DEFAULT 1');
      await addColumnIfMissing(db, 'delivery_logs', 'user_id', 'INTEGER DEFAULT 1');

      const optOutTableExists = await get(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='opt_out_contacts'");
      if (optOutTableExists) {
        const hasUserId = await columnExists(db, 'opt_out_contacts', 'user_id');
        if (!hasUserId) {
          await run(db, "ALTER TABLE opt_out_contacts RENAME TO opt_out_contacts_old");
          await run(db, `CREATE TABLE opt_out_contacts (
            user_id INTEGER DEFAULT 1,
            phone_number TEXT,
            source TEXT DEFAULT 'MANUAL',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, phone_number),
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
          )`);
          
          await run(db, `INSERT OR IGNORE INTO opt_out_contacts (user_id, phone_number, source, created_at)
                         SELECT 1, phone_number, source, created_at FROM opt_out_contacts_old`);
          
          await run(db, "DROP TABLE opt_out_contacts_old");
        }
      } else {
        await run(db, `CREATE TABLE opt_out_contacts (
          user_id INTEGER DEFAULT 1,
          phone_number TEXT,
          source TEXT DEFAULT 'MANUAL',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, phone_number),
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )`);
      }
      
      await run(db, 'DROP INDEX IF EXISTS idx_opt_out_contacts_phone_number');
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_opt_out_contacts_user_phone ON opt_out_contacts (user_id, phone_number)');
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id)');
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_contact_groups_user_id ON contact_groups (user_id)');
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_chatbot_flows_user_id ON chatbot_flows (user_id)');
      await run(db, 'CREATE INDEX IF NOT EXISTS idx_delivery_logs_user_id ON delivery_logs (user_id)');
    }
  },
  {
    id: '013_performance_indexes',
    description: 'Add performance indexes for multi-tenant and foreign key queries to prevent full table scans.',
    useTransaction: false,
    up: async (db) => {
      await exec(db, [
        'CREATE INDEX IF NOT EXISTS idx_campaigns_session_id ON campaigns (session_id)',
        'CREATE INDEX IF NOT EXISTS idx_warmer_campaigns_user_id ON warmer_campaigns (user_id)',
        'CREATE INDEX IF NOT EXISTS idx_warmer_templates_user_id ON warmer_templates (user_id)',
        'CREATE INDEX IF NOT EXISTS idx_message_templates_user_id ON message_templates (user_id)'
      ]);
    }
  },
  {
    id: '014_auth_token_revocation_and_campaign_owner',
    description: 'Add user token revocation metadata, refresh token store, and campaign owner index.',
    up: async (db) => {
      await addColumnIfMissing(db, 'users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');
      await addColumnIfMissing(db, 'users', 'password_changed_at', 'DATETIME');
      await addColumnIfMissing(db, 'campaigns', 'user_id', 'INTEGER DEFAULT 1');

      await run(db, `UPDATE campaigns
        SET user_id = COALESCE((
          SELECT user_id FROM sessions WHERE sessions.session_id = campaigns.session_id
        ), user_id, 1)
        WHERE user_id IS NULL OR user_id = 1`);

      await exec(db, [
        `CREATE TABLE IF NOT EXISTS user_refresh_tokens (
          jti TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          token_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NOT NULL,
          revoked_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )`,
        'CREATE INDEX IF NOT EXISTS idx_user_refresh_tokens_user_id ON user_refresh_tokens (user_id)',
        'CREATE INDEX IF NOT EXISTS idx_user_refresh_tokens_expires_at ON user_refresh_tokens (expires_at)',
        'CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns (user_id)'
      ]);
    }
  },
  {
    id: '015_chatbot_flow_session_mapping',
    description: 'Create normalized chatbot flow session assignment table for scalable runtime matching.',
    up: async (db) => {
      await exec(db, [
        `CREATE TABLE IF NOT EXISTS chatbot_flow_sessions (
          flow_id INTEGER NOT NULL,
          session_id TEXT NOT NULL,
          user_id INTEGER NOT NULL DEFAULT 1,
          assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (flow_id, session_id),
          FOREIGN KEY (flow_id) REFERENCES chatbot_flows (id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )`,
        'CREATE INDEX IF NOT EXISTS idx_chatbot_flow_sessions_session ON chatbot_flow_sessions (session_id, flow_id)',
        'CREATE INDEX IF NOT EXISTS idx_chatbot_flow_sessions_user_session ON chatbot_flow_sessions (user_id, session_id)'
      ]);

      const flows = await all(db, 'SELECT id, session_ids, user_id FROM chatbot_flows');
      const needsLegacyUser = flows.some((flow) => !flow.user_id || Number(flow.user_id) === 1);
      const legacyUser = needsLegacyUser ? await get(db, 'SELECT id FROM users WHERE id = 1') : null;
      if (needsLegacyUser && !legacyUser) {
        await run(
          db,
          `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
           VALUES (1, 'legacy-admin', 'legacy-placeholder', 'Legacy Administrator', 'admin', 0)`
        );
      }

      for (const flow of flows) {
        let sessionIds = [];
        try {
          const parsed = JSON.parse(flow.session_ids || '[]');
          if (Array.isArray(parsed)) {
            sessionIds = [...new Set(parsed.map((id) => String(id || '').trim()).filter(Boolean))];
          }
        } catch {
          sessionIds = [];
        }

        for (const sessionId of sessionIds) {
          await run(
            db,
            `INSERT OR IGNORE INTO chatbot_flow_sessions (flow_id, session_id, user_id)
             VALUES (?, ?, ?)`,
            [flow.id, sessionId, flow.user_id || 1]
          );
        }
      }
    }
  },
  {
    id: '016_user_device_limit',
    description: 'Add per-user WhatsApp device limit for SaaS tenant entitlement control.',
    up: async (db) => {
      await addColumnIfMissing(db, 'users', 'device_limit', 'INTEGER NOT NULL DEFAULT 1');
      await run(db, "UPDATE users SET device_limit = 1 WHERE device_limit IS NULL OR device_limit < 0");
    }
  },
  {
    id: '017_audit_logs',
    description: 'Create append-only audit_logs table for SaaS compliance trail.',
    up: async (db) => {
      await run(db, `CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id INTEGER,
        actor_username TEXT,
        actor_role TEXT,
        event_type TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        ip_address TEXT,
        result TEXT NOT NULL DEFAULT 'success',
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await run(db, `CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_user_id)`);
      await run(db, `CREATE INDEX IF NOT EXISTS idx_audit_logs_event ON audit_logs (event_type)`);
      await run(db, `CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at)`);
    }
  },
  {
    id: '018_billing_and_entitlements',
    description: 'Add subscription_plans table and subscription fields to users for SaaS billing enforcement.',
    up: async (db) => {
      await run(db, `CREATE TABLE IF NOT EXISTS subscription_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        max_sessions INTEGER NOT NULL DEFAULT 1,
        max_campaigns_per_month INTEGER NOT NULL DEFAULT 1,
        max_flows INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Create a default plan if none exists
      const planCount = await get(db, 'SELECT COUNT(*) as count FROM subscription_plans');
      if (planCount.count === 0) {
        await run(db, `
          INSERT INTO subscription_plans (id, name, max_sessions, max_campaigns_per_month, max_flows, is_default)
          VALUES (1, 'Starter', 1, 1, 1, 1)
        `);
      }

      await addColumnIfMissing(db, 'users', 'plan_id', 'INTEGER');
      await addColumnIfMissing(db, 'users', 'subscription_status', "TEXT DEFAULT 'active'");
      await addColumnIfMissing(db, 'users', 'subscription_expires_at', 'DATETIME');
      await addColumnIfMissing(db, 'users', 'billing_reference', 'TEXT');

      // Update existing users to the default plan
      await run(db, `
        UPDATE users 
        SET plan_id = 1, 
            subscription_status = 'active', 
            subscription_expires_at = datetime('now', '+1 year')
        WHERE plan_id IS NULL
      `);
    }
  },
  {
    id: '019_uploaded_media_metadata',
    description: 'Create tenant-owned uploaded media metadata for authorized media downloads.',
    up: async (db) => {
      await run(db, `CREATE TABLE IF NOT EXISTS uploaded_media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL UNIQUE,
        original_name TEXT,
        mime_type TEXT,
        media_type TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        user_id INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);
      await run(db, `CREATE INDEX IF NOT EXISTS idx_uploaded_media_user ON uploaded_media (user_id)`);
      await run(db, `CREATE INDEX IF NOT EXISTS idx_uploaded_media_created ON uploaded_media (created_at)`);
    }
  },
  {
    id: '020_admin_unlimited_subscription',
    description: 'Set subscription_expires_at to NULL for main admin (id 1) to make it unlimited.',
    up: async (db) => {
      await run(db, 'UPDATE users SET subscription_expires_at = NULL WHERE id = 1');
    }
  },
  {
    id: '021_whatsapp_contacts_tenant_isolation',
    description: 'Scope synced WhatsApp contacts per tenant and allow the same JID for different users.',
    up: async (db) => {
      const legacyContactCount = await get(db, 'SELECT COUNT(*) AS count FROM whatsapp_contacts');
      if (Number(legacyContactCount?.count || 0) > 0) {
        const legacyOwner = await get(db, 'SELECT id FROM users WHERE id = 1');
        if (!legacyOwner) {
          await run(
            db,
            `INSERT INTO users (id, username, password_hash, display_name, role, is_active)
             VALUES (1, ?, 'legacy-placeholder', 'Legacy Contact Owner', 'admin', 0)`,
            [`legacy-contact-owner-${Date.now()}`]
          );
        }
      }

      await exec(db, [
        `CREATE TABLE whatsapp_contacts_tenant (
          user_id INTEGER NOT NULL DEFAULT 1,
          jid TEXT NOT NULL,
          name TEXT,
          notify TEXT,
          verified_name TEXT,
          lid TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, jid),
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )`,
        `INSERT INTO whatsapp_contacts_tenant
          (user_id, jid, name, notify, verified_name, lid, created_at)
         SELECT 1, jid, name, notify, verified_name, lid, COALESCE(created_at, CURRENT_TIMESTAMP)
         FROM whatsapp_contacts`,
        'DROP TABLE whatsapp_contacts',
        'ALTER TABLE whatsapp_contacts_tenant RENAME TO whatsapp_contacts',
        'CREATE INDEX idx_whatsapp_contacts_user_lid ON whatsapp_contacts (user_id, lid)'
      ]);
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
