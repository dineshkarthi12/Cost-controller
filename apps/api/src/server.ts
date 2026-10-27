import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { startJobs } from './jobs.js';

const app = createApp();
const server = app.listen(config.port, () => logger.info(`TOPROCK API listening on :${config.port}`));
if (!config.disableJobs) startJobs();

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
