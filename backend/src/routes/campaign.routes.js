import express from 'express';
import { createCampaign, getCampaignProgress, getCampaigns, deleteCampaign } from '../controllers/campaign.controller.js';
import { validateBody } from '../utils/validator.js';
import { requireActiveSubscription, checkCampaignQuota } from '../middleware/entitlement.middleware.js';

const router = express.Router();

router.get('/', getCampaigns);
router.post('/', 
  requireActiveSubscription,
  checkCampaignQuota,
  validateBody({
    session_id: { required: true, type: 'string', min: 1 },
    message: { required: true, type: 'string', min: 1 },
    targets: { required: true, type: 'array', min: 1 },
    attachment_url: { required: false, type: 'string' },
    attachment_type: { required: false, type: 'string', allowedValues: ['Image', 'Video', 'Audio', 'Document'] },
    attachment_name: { required: false, type: 'string' }
  }), 
  createCampaign
);
router.get('/:id', getCampaignProgress);
router.delete('/:id', deleteCampaign);

export default router;
