import express from 'express';
import { 
  getMonitoringStatus, 
  getRepairLogs, 
  getFailedReplies, 
  updateFailedReplyStatus 
} from '../controllers/monitoring.controller.js';
import { requireRole } from '../middleware/admin_auth.middleware.js';

const router = express.Router();

router.use(requireRole('admin'));

router.get('/status', getMonitoringStatus);
router.get('/repair-logs', getRepairLogs);
router.get('/failed-replies', getFailedReplies);
router.patch('/failed-replies/:id/status', updateFailedReplyStatus);

export default router;
