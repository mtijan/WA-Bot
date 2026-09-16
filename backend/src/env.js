import { config as loadDotEnv } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
export const localEnvPath = process.env.WA_BOT_ENV_FILE
  ? resolve(process.env.WA_BOT_ENV_FILE)
  : resolve(sourceDirectory, '..', '.env');

// Process-level variables (systemd, CI, or the launcher) intentionally win over
// local .env values. The file is optional and remains ignored by Git.
loadDotEnv({
  path: localEnvPath,
  override: false,
  quiet: true
});
