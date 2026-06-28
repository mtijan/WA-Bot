import express from 'express';
import {
  getTemplates,
  createTemplate,
  deleteTemplate,
  getCampaigns,
  createCampaign,
  stopCampaign,
  getCampaignLogs,
  deleteCampaign
} from '../controllers/warmer.controller.js';
import { validateBody } from '../utils/validator.js';
import { requireActiveSubscription } from '../middleware/entitlement.middleware.js';

const router = express.Router();

// Rute Template Warmer
router.get('/templates', getTemplates);
router.post('/templates', requireActiveSubscription, validateBody({
  name: { required: true, type: 'string', min: 1, max: 100 },
  messages: { required: true, type: 'string', min: 1 }
}), createTemplate);
router.delete('/templates/:id', deleteTemplate);

// Rute Kampanye Warmer
router.get('/campaigns', getCampaigns);
router.post('/campaigns', requireActiveSubscription, validateBody({
  name: { required: true, type: 'string', min: 1, max: 100 },
  device_ids: { required: true, type: 'string', min: 1 },
  messages: { required: true, type: 'string', min: 1 },
  min_delay: { required: true, type: 'number' },
  max_delay: { required: true, type: 'number' },
  duration: { required: true, type: 'number' }
}), createCampaign);
router.post('/campaigns/:id/stop', stopCampaign);
router.get('/campaigns/:id/logs', getCampaignLogs);
router.delete('/campaigns/:id', deleteCampaign);

export default router;
