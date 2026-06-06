import { Router } from 'express';
import { createOptOut, deleteOptOut, getOptOuts } from '../controllers/opt_out.controller.js';
import { validateBody } from '../utils/validator.js';

const router = Router();

router.get('/', getOptOuts);
router.post('/', validateBody({
  phone_number: { required: true, type: 'string', min: 5, max: 20 }
}), createOptOut);
router.delete('/:phoneNumber', deleteOptOut);

export default router;
