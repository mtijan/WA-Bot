import express from 'express';
import { getDetailedGroups, getInviteLink, exportParticipants } from '../controllers/group_grabber.controller.js';
import whatsappService from '../services/whatsapp.service.js';
import { isSessionManagerClientEnabled, sessionManagerClient } from '../services/session_manager_client.service.js';

const router = express.Router();

router.get('/groups/:sessionId', getDetailedGroups);
router.post('/invite-link', getInviteLink);
router.post('/export-participants', exportParticipants);

// Endpoint untuk memaksa re-sinkronisasi kontak
router.post('/force-sync-contacts', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ status: 'error', message: 'sessionId wajib diisi.' });
    }
    const response = isSessionManagerClientEnabled()
      ? await sessionManagerClient.forceSyncContacts(sessionId)
      : { data: await whatsappService.forceSyncContacts(sessionId) };
    const result = response.data;
    res.json({ status: 'success', data: result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

export default router;
