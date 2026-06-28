import express from 'express';
import { listAuditLogs } from '../controllers/audit.controller.js';

const router = express.Router();

// GET /api/audit-logs
// Admin: all entries. Non-admin: own entries only (enforced in controller).
router.get('/', listAuditLogs);

export default router;