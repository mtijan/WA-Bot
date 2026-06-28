import express from 'express';
import { createAdminAuthMiddleware, requireRole } from '../middleware/admin_auth.middleware.js';
import * as planController from '../controllers/plan.controller.js';

const router = express.Router();

router.use(createAdminAuthMiddleware());
router.use(requireRole('admin'));

router.get('/', planController.getPlans);
router.post('/', planController.createPlan);
router.put('/:id', planController.updatePlan);
router.delete('/:id', planController.deletePlan);

export default router;
