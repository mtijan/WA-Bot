import bcrypt from 'bcryptjs';
import db, { databaseReady, dbRun, dbGet } from '../src/database.js';

function getArgValue(argName) {
  const index = process.argv.indexOf(argName);
  if (index !== -1 && index + 1 < process.argv.length) {
    return process.argv[index + 1];
  }
  return null;
}

try {
  await databaseReady;
  
  const username = getArgValue('--username') || 'admin';
  const password = getArgValue('--password');
  const role = getArgValue('--role') || 'admin';
  const displayName = getArgValue('--name') || 'Administrator';

  if (!password) {
    console.error('Error: --password is required.');
    console.log('Usage: node scripts/seed_admin_user.js --username <username> --password <password> [--role admin|user] [--name displayName]');
    process.exit(1);
  }

  if (username.length < 3) {
    console.error('Error: Username must be at least 3 characters.');
    process.exit(1);
  }

  if (password.length < 12) {
    console.error('Error: Password must be at least 12 characters.');
    process.exit(1);
  }

  if (!['admin', 'user'].includes(role)) {
    console.error('Error: Role must be "admin" or "user".');
    process.exit(1);
  }

  const existingUser = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
  if (existingUser) {
    console.warn(`User "${username}" already exists. Updating password and role...`);
    const salt = await bcrypt.genSalt(12);
    const hash = await bcrypt.hash(password, salt);
    await dbRun(
      'UPDATE users SET password_hash = ?, role = ?, display_name = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE username = ?',
      [hash, role, displayName, username]
    );
    console.log(`User "${username}" updated successfully.`);
  } else {
    const salt = await bcrypt.genSalt(12);
    const hash = await bcrypt.hash(password, salt);
    await dbRun(
      'INSERT INTO users (username, password_hash, display_name, role, is_active) VALUES (?, ?, ?, ?, 1)',
      [username, hash, displayName, role]
    );
    console.log(`User "${username}" created successfully with role "${role}".`);
  }
} catch (error) {
  console.error('Failed to create user:', error);
  process.exit(1);
} finally {
  db.close();
}
