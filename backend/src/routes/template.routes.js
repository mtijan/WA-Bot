import express from 'express';
import { getTemplates, createTemplate, deleteTemplate } from '../controllers/template.controller.js';
import { validateBody } from '../utils/validator.js';

const router = express.Router();

router.get('/', getTemplates);
router.post('/', validateBody({
  name: { required: true, type: 'string', min: 1, max: 100 },
  content: { required: true, type: 'string', min: 1 },
  type: { type: 'string', allowedValues: ['text', 'image', 'video', 'poll', 'contact'] }
}), createTemplate);
router.delete('/:id', deleteTemplate);

export default router;
