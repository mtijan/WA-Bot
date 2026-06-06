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

const router = express.Router();

router.get('/', getProxies);
router.post('/', validateBody({
  name: { required: true, type: 'string', min: 1, max: 100 },
  proxy_url: { required: true, type: 'string', min: 5 }
}), createProxy);
router.get('/offline-db/status', getOfflineDbStatus);
router.post('/offline-db/download', startOfflineDbDownload);
router.delete('/:id', deleteProxy);
router.post('/:id/test', testProxyConnection);

router.get('/settings/:key', getSetting);
router.post('/settings/:key', saveSetting);

export default router;
