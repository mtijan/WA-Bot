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

const router = express.Router();

// Rute Template Warmer
router.get('/templates', getTemplates);
router.post('/templates', createTemplate);
router.delete('/templates/:id', deleteTemplate);

// Rute Kampanye Warmer
router.get('/campaigns', getCampaigns);
router.post('/campaigns', createCampaign);
router.post('/campaigns/:id/stop', stopCampaign);
router.get('/campaigns/:id/logs', getCampaignLogs);
router.delete('/campaigns/:id', deleteCampaign);

export default router;
