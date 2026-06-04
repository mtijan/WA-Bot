import express from 'express';
import { getFlows, createFlow, updateFlow, deleteFlow, updateFlowStatus, exportFlows, importFlows } from '../controllers/chatbot.controller.js';

const router = express.Router();

router.get('/', getFlows);
router.get('/export', exportFlows);
router.post('/import', importFlows);
router.post('/', createFlow);
router.put('/:id', updateFlow);
router.delete('/:id', deleteFlow);
router.patch('/:id/status', updateFlowStatus);

export default router;
