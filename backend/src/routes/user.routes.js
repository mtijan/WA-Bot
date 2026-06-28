import express from 'express';
import {
  listUsers,
  createUser,
  updateUser,
  changePassword,
  deleteUser
} from '../controllers/user.controller.js';
import { requireRole } from '../middleware/admin_auth.middleware.js';
import { validateBody } from '../utils/validator.js';

const router = express.Router();
const subscriptionStatuses = ['active', 'inactive', 'expired', 'past_due', 'canceled'];
const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}(?:[T ][0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-][0-2]\d:[0-5]\d)?)?$/;

router.get('/', requireRole('admin'), listUsers);

router.post(
  '/',
  requireRole('admin'),
  validateBody({
    username: { required: true, type: 'string', min: 3, max: 30, matches: /^[a-zA-Z0-9_.-]+$/ },
    password: { required: true, type: 'string', min: 12, max: 100 },
    role: { required: true, type: 'string', allowedValues: ['admin', 'user'] },
    display_name: { type: 'string', max: 100 },
    device_limit: { type: 'number', min: 0, max: 100 },
    plan_id: { type: 'number', min: 1 },
    subscription_status: { type: 'string', allowedValues: subscriptionStatuses },
    subscription_expires_at: { type: 'string', max: 40, matches: isoDateTimePattern },
    billing_reference: { type: 'string', max: 120 }
  }),
  createUser
);

router.patch(
  '/:id',
  requireRole('admin'),
  validateBody({
    display_name: { type: 'string', max: 100 },
    role: { type: 'string', allowedValues: ['admin', 'user'] },
    is_active: { type: 'number', allowedValues: [0, 1] },
    device_limit: { type: 'number', min: 0, max: 100 },
    plan_id: { type: 'number', min: 1 },
    subscription_status: { type: 'string', allowedValues: subscriptionStatuses },
    subscription_expires_at: { type: 'string', max: 40, matches: isoDateTimePattern },
    billing_reference: { type: 'string', max: 120 }
  }),
  updateUser
);

router.patch(
  '/:id/password',
  validateBody({
    old_password: { type: 'string' },
    new_password: { required: true, type: 'string', min: 12, max: 100 }
  }),
  changePassword
);

router.delete('/:id', requireRole('admin'), deleteUser);

export default router;
