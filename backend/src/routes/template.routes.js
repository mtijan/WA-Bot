import express from 'express';
import { getTemplates, createTemplate, updateTemplate, deleteTemplate } from '../controllers/template.controller.js';
import { validateBody } from '../utils/validator.js';

const router = express.Router();

const templateValidation = {
  name: { required: true, type: 'string', min: 1, max: 100 },
  content: { required: true, type: 'string', min: 1 },
  type: { type: 'string', allowedValues: ['text', 'image', 'video', 'poll', 'contact', 'document', 'audio'] }
};

router.get('/', getTemplates);
router.post('/', validateBody(templateValidation), createTemplate);
router.put('/:id', validateBody(templateValidation), updateTemplate);
router.delete('/:id', deleteTemplate);

export default router;
