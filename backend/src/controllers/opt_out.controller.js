import { listOptOuts, recordOptOut, removeOptOut } from '../services/opt_out.service.js';
import { sendError, sendSuccess } from '../utils/http_response.js';
import { logError } from '../logger.js';

export const getOptOuts = async (req, res) => {
  try {
    const list = await listOptOuts(req.auth.userId);
    return sendSuccess(res, list);
  } catch (error) {
    logError('getOptOuts', error);
    return sendError(res, 500, 'GET_OPT_OUTS_ERROR', 'Gagal memuat suppression list.');
  }
};

export const createOptOut = async (req, res) => {
  try {
    const { phone_number } = req.body;
    const phoneNumber = await recordOptOut(phone_number, req.auth.userId, 'MANUAL');
    return sendSuccess(res, { phone_number: phoneNumber }, 201, { message: 'Nomor ditambahkan ke suppression list.' });
  } catch (error) {
    logError('createOptOut', error, { body: req.body });
    return sendError(res, 400, 'CREATE_OPT_OUT_ERROR', error.message || 'Gagal menambahkan nomor ke suppression list.');
  }
};

export const deleteOptOut = async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    await removeOptOut(phoneNumber, req.auth.userId);
    return sendSuccess(res, null, 200, { message: 'Nomor dihapus dari suppression list.' });
  } catch (error) {
    logError('deleteOptOut', error, { params: req.params });
    return sendError(res, 400, 'DELETE_OPT_OUT_ERROR', error.message || 'Gagal menghapus nomor dari suppression list.');
  }
};
