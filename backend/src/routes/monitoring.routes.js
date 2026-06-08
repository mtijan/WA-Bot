import express from 'express';
import { 
  getMonitoringStatus, 
  getRepairLogs, 
  getFailedReplies, 
  updateFailedReplyStatus 
} from '../controllers/monitoring.controller.js';

const router = express.Router();

router.get('/status', getMonitoringStatus);
router.get('/repair-logs', getRepairLogs);
router.get('/failed-replies', getFailedReplies);
router.patch('/failed-replies/:id/status', updateFailedReplyStatus);

export default router;
