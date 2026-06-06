import { config } from './config.js';
import { logger, logError } from './logger.js';
import { getRuntimeRole, shouldStartHttpServer, startRuntimeServices } from './runtime.js';
import { createApp } from './app.js';

const PORT = config.port;
const runtimeRole = getRuntimeRole();
const app = createApp({ runtimeRole });

const boot = async () => {
  if (shouldStartHttpServer(runtimeRole)) {
    app.listen(PORT, async () => {
      logger.info({ port: PORT, role: runtimeRole }, 'WA-Bot server started');
      await startRuntimeServices(runtimeRole);
    });
    return;
  }

  await startRuntimeServices(runtimeRole);
};

boot().catch((err) => {
  logError('runtime_boot', err);
  process.exit(1);
});
