import { listOptOuts, recordOptOut, removeOptOut } from '../services/opt_out.service.js';

export const getOptOuts = async (req, res) => {
  try {
    res.json({ status: 'success', data: await listOptOuts() });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const createOptOut = async (req, res) => {
  try {
    const phoneNumber = await recordOptOut(req.body.phone_number, 'MANUAL');
    res.status(201).json({ status: 'success', data: { phone_number: phoneNumber } });
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
};

export const deleteOptOut = async (req, res) => {
  try {
    await removeOptOut(req.params.phoneNumber);
    res.json({ status: 'success', message: 'Nomor dihapus dari suppression list.' });
  } catch (error) {
    res.status(400).json({ status: 'error', message: error.message });
  }
};

