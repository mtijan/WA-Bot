import express from 'express';
import { getFlows, createFlow, updateFlow, deleteFlow, updateFlowStatus, exportFlows, importFlows } from '../controllers/chatbot.controller.js';
import { validateBody } from '../utils/validator.js';

const router = express.Router();

router.get('/', getFlows);
router.get('/export', exportFlows);
router.post('/import', validateBody({
  flows: { required: true, type: 'array' }
}), importFlows);
router.post('/', validateBody({
  flow_name: { required: true, type: 'string', min: 1, max: 100 },
  keywords: { required: true, type: 'string', min: 1 }
}), createFlow);
router.put('/:id', validateBody({
  flow_name: { required: true, type: 'string', min: 1, max: 100 },
  keywords: { required: true, type: 'string', min: 1 }
}), updateFlow);
router.delete('/:id', deleteFlow);
router.patch('/:id/status', validateBody({
  status: { required: true, type: 'string', allowedValues: ['ACTIVE', 'INACTIVE'] }
}), updateFlowStatus);

export default router;
