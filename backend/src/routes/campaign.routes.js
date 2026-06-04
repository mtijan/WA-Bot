import express from 'express';
import { createCampaign, getCampaignProgress, getCampaigns, deleteCampaign } from '../controllers/campaign.controller.js';

const router = express.Router();

router.get('/', getCampaigns);
router.post('/', createCampaign);
router.get('/:id', getCampaignProgress);
router.delete('/:id', deleteCampaign);

export default router;
