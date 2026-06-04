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

const router = express.Router();

router.get('/', getProxies);
router.post('/', createProxy);
router.get('/offline-db/status', getOfflineDbStatus);
router.post('/offline-db/download', startOfflineDbDownload);
router.delete('/:id', deleteProxy);
router.post('/:id/test', testProxyConnection);

router.get('/settings/:key', getSetting);
router.post('/settings/:key', saveSetting);

export default router;

