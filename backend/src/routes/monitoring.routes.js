import express from 'express';
import { getMonitoringStatus } from '../controllers/monitoring.controller.js';

const router = express.Router();

/**
 * GET /api/monitoring/status
 * Snapshot status sistem: health, sesi, memory, campaign, warmer, chatbot, delivery logs.
 */
router.get('/status', getMonitoringStatus);

export default router;
