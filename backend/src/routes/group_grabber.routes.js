import express from 'express';
import { getDetailedGroups, getInviteLink, exportParticipants } from '../controllers/group_grabber.controller.js';
import whatsappService from '../services/whatsapp.service.js';

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
    const result = await whatsappService.forceSyncContacts(sessionId);
    res.json({ status: 'success', data: result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

export default router;
