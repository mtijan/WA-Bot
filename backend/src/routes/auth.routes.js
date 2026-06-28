import express from 'express';
import { getAuthStatus, login, logout, refreshToken } from '../controllers/auth.controller.js';

const router = express.Router();

router.get('/me', getAuthStatus);
router.post('/login', login);
router.post('/logout', logout);
router.post('/refresh', refreshToken);

export default router;
