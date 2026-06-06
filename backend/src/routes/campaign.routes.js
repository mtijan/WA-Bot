import express from 'express';
import { createCampaign, getCampaignProgress, getCampaigns, deleteCampaign } from '../controllers/campaign.controller.js';
import { validateBody } from '../utils/validator.js';

const router = express.Router();

router.get('/', getCampaigns);
router.post('/', validateBody({
  session_id: { required: true, type: 'string', min: 1 },
  message: { required: true, type: 'string', min: 1 },
  targets: { required: true, type: 'array', min: 1 }
}), createCampaign);
router.get('/:id', getCampaignProgress);
router.delete('/:id', deleteCampaign);

export default router;
