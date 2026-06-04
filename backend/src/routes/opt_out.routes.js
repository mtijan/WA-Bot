import { Router } from 'express';
import { createOptOut, deleteOptOut, getOptOuts } from '../controllers/opt_out.controller.js';

const router = Router();

router.get('/', getOptOuts);
router.post('/', createOptOut);
router.delete('/:phoneNumber', deleteOptOut);

export default router;

