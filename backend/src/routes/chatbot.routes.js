import express from 'express';
import { getFlows, getFlowById, createFlow, updateFlow, updateFlowSettings, deleteFlow, updateFlowStatus, exportFlows, importFlows } from '../controllers/chatbot.controller.js';
import { validateBody } from '../utils/validator.js';
import { requireActiveSubscription, checkFlowImportQuota, checkFlowQuota } from '../middleware/entitlement.middleware.js';

const router = express.Router();

router.get('/', getFlows);
router.get('/export', exportFlows);
router.get('/:id', getFlowById);
router.post('/import', 
  requireActiveSubscription,
  validateBody({
    flows: { required: true, type: 'array' }
  }),
  checkFlowImportQuota,
  importFlows
);
router.post('/', 
  requireActiveSubscription,
  checkFlowQuota,
  validateBody({
  flow_name: { required: true, type: 'string', min: 1, max: 100 },
  keywords: { required: true, type: 'string', min: 1 }
}), createFlow);
router.put('/:id', validateBody({
  flow_name: { required: true, type: 'string', min: 1, max: 100 },
  keywords: { required: true, type: 'string', min: 1 }
}), updateFlow);
router.patch('/:id/settings', validateBody({
  flow_name: { required: true, type: 'string', min: 1, max: 100 },
  keywords: { required: true, type: 'string', min: 1 }
}), updateFlowSettings);
router.delete('/:id', deleteFlow);
router.patch('/:id/status', validateBody({
  status: { required: true, type: 'string', allowedValues: ['ACTIVE', 'INACTIVE'] }
}), updateFlowStatus);

export default router;
