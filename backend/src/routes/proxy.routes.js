import express from 'express';
import { 
  getProxies, 
  createProxy, 
  deleteProxy, 
  testProxyConnection,
  getSetting,
  saveSetting,
  getOfflineDbStatus,
  startOfflineDbDownload
} from '../controllers/proxy.controller.js';
import { validateBody } from '../utils/validator.js';
import { requireRole } from '../middleware/admin_auth.middleware.js';

const router = express.Router();

router.get('/', requireRole('admin'), getProxies);
router.post('/', requireRole('admin'), validateBody({
  name: { required: true, type: 'string', min: 1, max: 100 },
  proxy_url: { required: true, type: 'string', min: 5 }
}), createProxy);
router.get('/offline-db/status', requireRole('admin'), getOfflineDbStatus);
router.post('/offline-db/download', requireRole('admin'), startOfflineDbDownload);
router.delete('/:id', requireRole('admin'), deleteProxy);
router.post('/:id/test', requireRole('admin'), testProxyConnection);

router.get('/settings/:key', requireRole('admin'), getSetting);
router.post('/settings/:key', requireRole('admin'), saveSetting);

export default router;
