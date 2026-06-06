import whatsappService from '../services/whatsapp.service.js';
import { dbAll, dbRun } from '../database.js';
import { isSessionManagerClientEnabled, sessionManagerClient } from '../services/session_manager_client.service.js';

// Helper: Deteksi Info Negara
const getCountryInfo = (num) => {
  if (num.startsWith('62')) {
    return { code: '+62', name: 'Indonesia' };
  } else if (num.startsWith('1')) {
    return { code: '+1', name: 'United States' };
  } else if (num.startsWith('60')) {
    return { code: '+60', name: 'Malaysia' };
  } else if (num.startsWith('65')) {
    return { code: '+65', name: 'Singapore' };
  } else if (num.startsWith('84')) {
    return { code: '+84', name: 'Vietnam' };
  } else if (num.startsWith('91')) {
    return { code: '+91', name: 'India' };
  } else if (num.startsWith('44')) {
    return { code: '+44', name: 'United Kingdom' };
  } else if (num.startsWith('61')) {
    return { code: '+61', name: 'Australia' };
  } else if (num.startsWith('81')) {
    return { code: '+81', name: 'Japan' };
  } else if (num.startsWith('82')) {
    return { code: '+82', name: 'South Korea' };
  } else if (num.startsWith('966')) {
    return { code: '+966', name: 'Saudi Arabia' };
  } else if (num.startsWith('971')) {
    return { code: '+971', name: 'United Arab Emirates' };
  }
  
  if (num.length > 10) {
    return { code: '+' + num.slice(0, 2), name: 'International' };
  }
  return { code: '+62', name: 'Indonesia' }; // Default fallback
};

// Helper: Format Nomor Telepon (e.g. +62 895-2593-9314)
const formatPhoneNumber = (num) => {
  const info = getCountryInfo(num);
  const code = info.code;
  const rest = num.slice(code.length - 1); // e.g. for +62 (length 3), slice 2 -> '895...'
  
  if (code === '+62' && rest.length >= 9) {
    return `${code} ${rest.slice(0, 3)}-${rest.slice(3, 7)}-${rest.slice(7)}`;
  } else if (code === '+1' && rest.length === 10) {
    return `${code} (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6)}`;
  }
  
  if (rest.length > 7) {
    return `${code} ${rest.slice(0, 3)}-${rest.slice(3, 6)}-${rest.slice(6)}`;
  }
  return `${code} ${rest}`;
};

// Helper: CSV escape (menghindari double quotes berlebih)
const escapeCSV = (val) => {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

// Helper: Normalisasi Nomor Telepon untuk Pencocokan Database (e.g. 0812 -> 62812)
const normalizePhoneForMatching = (num) => {
  if (!num) return '';
  let clean = num.toString().replace(/\D/g, '');
  if (clean.startsWith('0')) {
    clean = '62' + clean.slice(1);
  }
  return clean;
};

export const getDetailedGroups = async (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId) {
    return res.status(400).json({
      status: 'error',
      message: 'Parameter sessionId wajib diisi.'
    });
  }

  try {
    const response = isSessionManagerClientEnabled()
      ? await sessionManagerClient.getDetailedGroups(sessionId)
      : { data: await whatsappService.getDetailedGroups(sessionId) };
    const groups = response.data || [];
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.json({
      status: 'success',
      data: groups
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};

export const getInviteLink = async (req, res) => {
  const { sessionId, groupId } = req.body;
  if (!sessionId || !groupId) {
    return res.status(400).json({
      status: 'error',
      message: 'Parameter sessionId dan groupId wajib diisi.'
    });
  }

  try {
    const response = isSessionManagerClientEnabled()
      ? await sessionManagerClient.getGroupInviteLink(sessionId, groupId)
      : { data: { inviteLink: await whatsappService.getGroupInviteLink(sessionId, groupId) } };
    const inviteLink = response.data?.inviteLink;
    res.json({
      status: 'success',
      data: { inviteLink }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};

export const exportParticipants = async (req, res) => {
  const { sessionId, groupIds } = req.body;
  if (!sessionId || !groupIds || !Array.isArray(groupIds)) {
    return res.status(400).json({
      status: 'error',
      message: 'Parameter sessionId dan groupIds (array) wajib diisi.'
    });
  }

  try {
    let sock = null;
    let selectedGroups = [];

    if (isSessionManagerClientEnabled()) {
      const response = await sessionManagerClient.getGroupsMetadata(sessionId, groupIds);
      selectedGroups = response.data || [];
    } else {
      sock = whatsappService.sockets[sessionId];
      if (!sock) {
        return res.status(404).json({
          status: 'error',
          message: `Sesi ${sessionId} tidak aktif atau belum terhubung.`
        });
      }
    }

    // Gabungkan kontak dari database whatsapp_contacts ke sock.contacts agar cache selalu lengkap terisi
    if (sock) {
      try {
        const dbWaContacts = await dbAll("SELECT * FROM whatsapp_contacts");
        if (!sock.contacts) sock.contacts = {};
        for (const c of dbWaContacts) {
          if (!sock.contacts[c.jid]) {
            sock.contacts[c.jid] = {
              id: c.jid,
              jid: c.jid,
              name: c.name,
              notify: c.notify,
              verifiedName: c.verified_name,
              lid: c.lid
            };
          }
        }
      } catch (err) {
        console.error("Gagal melakukan preload database whatsapp_contacts:", err.message);
      }
    }

    // Ambil live metadata untuk setiap grup agar anggota selalu fresh dan lengkap
    if (sock) {
      const ownJid = sock.authState?.creds?.me?.id || sock.user?.id;
      const ownJidClean = ownJid ? ownJid.split(':')[0].split('@')[0] + '@s.whatsapp.net' : '';

      const ownLid = sock.authState?.creds?.me?.lid || sock.user?.lid;
      const ownLidClean = ownLid ? ownLid.split(':')[0].split('@')[0] + '@lid' : '';

      for (const gid of groupIds) {
        try {
          const metadata = await sock.groupMetadata(gid);
          if (metadata) {
            const me = metadata.participants?.find(p => {
              const pJid = p.id.split(':')[0].split('@')[0] + '@s.whatsapp.net';
              const pLid = p.id.split(':')[0].split('@')[0] + '@lid';
              return (pJid === ownJidClean) || (pLid === ownLidClean);
            });
            const isAdmin = me && (me.admin === 'admin' || me.admin === 'superadmin');
            const isCommunity = !!(metadata.isCommunity || metadata.isCommunityAnnounce || metadata.id.includes('community'));

            selectedGroups.push({
              id: metadata.id,
              subject: metadata.subject,
              size: metadata.participants?.length || 0,
              isAdmin: !!isAdmin,
              isCommunity: isCommunity,
              participants: metadata.participants || []
            });
          }
        } catch (err) {
          console.error(`Gagal mengambil metadata grup live untuk ${gid}:`, err.message);
        }
      }
    }

    // Fallback jika live metadata gagal
    if (selectedGroups.length === 0 && sock) {
      const allGroups = await whatsappService.getDetailedGroups(sessionId);
      const fallbackGroups = allGroups.filter(g => groupIds.includes(g.id));
      selectedGroups.push(...fallbackGroups);
    }

    if (selectedGroups.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Grup terpilih tidak ditemukan.'
      });
    }

    // ========== FASE 1: Kumpulkan semua kontak dari berbagai sumber ==========

    // 1a. Kontak dari database lokal (input manual user)
    const dbContacts = await dbAll("SELECT name, phone_number FROM contacts");
    const contactsMap = new Map();
    for (const c of dbContacts) {
      const normalized = normalizePhoneForMatching(c.phone_number);
      if (normalized) {
        contactsMap.set(normalized, c.name);
      }
    }

    // 1b. Kontak dari database whatsapp_contacts (hasil sync otomatis)
    const waContactsDb = await dbAll("SELECT * FROM whatsapp_contacts");
    const waContactsMap = new Map();
    for (const c of waContactsDb) {
      waContactsMap.set(c.jid, c);
      if (c.lid) {
        waContactsMap.set(c.lid, c);
      }
      // Juga simpan berdasarkan nomor bersih
      const cleanNum = c.jid.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (cleanNum) {
        waContactsMap.set(cleanNum, c);
      }
    }

    // ========== FASE 2: Resolusi JID dan kumpulkan semua peserta unik ==========
    const uniqueParticipantsMap = new Map();
    const allResolvedJids = []; // Untuk batch onWhatsApp lookup nanti

    for (const g of selectedGroups) {
      for (const p of g.participants || []) {
        if (!p.id) continue;
        let jid = p.id;
        let isLid = jid.endsWith('@lid');
        let resolvedJid = p.jid || null;

        // Coba resolusi LID ke JID asli
        if (isLid && !resolvedJid) {
          // Cek sock.contacts cache
          const cachedLid = sock?.contacts?.[jid];
          if (cachedLid?.jid) {
            resolvedJid = cachedLid.jid;
          } else {
            // Cek whatsapp_contacts DB
            const dbWaContact = waContactsMap.get(jid);
            if (dbWaContact?.jid && !dbWaContact.jid.endsWith('@lid')) {
              resolvedJid = dbWaContact.jid;
            } else {
              // Scan cache kontak untuk mencari mapping lid -> jid
              for (const c of Object.values(sock?.contacts || {})) {
                if (c.lid === jid && c.jid) {
                  resolvedJid = c.jid;
                  break;
                }
              }
            }
          }
        }

        if (resolvedJid) {
          jid = resolvedJid;
          isLid = false;
        }

        const cleanNumber = jid.split('@')[0].split(':')[0].replace(/\D/g, '');

        if (isLid) {
          const cachedContact = sock?.contacts?.[jid] || sock?.contacts?.[p.id] || sock?.contacts?.[p.lid];
          const dbWa = waContactsMap.get(jid) || waContactsMap.get(p.id);
          let publicName = cachedContact?.name || cachedContact?.notify || cachedContact?.verifiedName || dbWa?.name || dbWa?.notify || dbWa?.verified_name || p.name || '';

          uniqueParticipantsMap.set(cleanNumber, {
            countryCode: '',
            countryName: 'Masked User (WhatsApp Privacy)',
            phoneNumber: jid,
            formattedPhone: 'Masked JID',
            myContact: 'FALSE',
            savedName: '',
            publicName: publicName,
            isBusiness: '',
            isBlocked: 'FALSE',
            labels: '',
            lastMsgText: '',
            lastMsgDate: '',
            lastMsgType: '',
            lastMsgUnreadStatus: ''
          });
        } else {
          const pJid = jid.split(':')[0].split('@')[0] + '@s.whatsapp.net';
          allResolvedJids.push({ cleanNumber, pJid, originalP: p, jid });
        }
      }
    }

    // ========== FASE 3: Batch lookup via onWhatsApp + getBusinessProfile ==========
    const businessProfileMap = new Map();

    // 3a. Batch onWhatsApp() check -- mengembalikan exists + verifiedName untuk akun bisnis
    try {
      if (sock) {
        const allNumbers = allResolvedJids.map(r => r.cleanNumber);
        const onWaResult = await sock.onWhatsApp(...allNumbers);
        if (Array.isArray(onWaResult)) {
          for (const r of onWaResult) {
            if (r.jid) {
              const num = r.jid.split('@')[0].split(':')[0].replace(/\D/g, '');
              businessProfileMap.set(num, {
                exists: r.exists,
                jid: r.jid,
                verifiedName: r.verifiedName || null,
                isBusiness: !!r.verifiedName
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Group Grabber] Batch onWhatsApp lookup gagal:', err.message);
    }

    // 3b. Untuk akun bisnis yang terdeteksi, coba ambil profil bisnis lebih detail
    for (const [num, info] of businessProfileMap) {
      if (sock && info.isBusiness && info.jid) {
        try {
          const profile = await sock.getBusinessProfile(info.jid);
          if (profile) {
            businessProfileMap.set(num, {
              ...info,
              businessName: profile.wid?.server ? null : (profile.description || null),
              verifiedName: profile.verifiedName || info.verifiedName
            });
          }
        } catch (err) {
          // Silent -- banyak nomor bukan akun bisnis
        }
      }
    }

    // ========== FASE 4: Bangun data peserta akhir ==========
    for (const { cleanNumber, pJid, originalP: p, jid } of allResolvedJids) {
      const normalizedPart = normalizePhoneForMatching(cleanNumber);

      // Cari nama tersimpan di DB kontak lokal
      let savedName = contactsMap.get(normalizedPart) || '';

      // Lookup dari sock.contacts cache
      const cachedContact = sock?.contacts?.[pJid] || sock?.contacts?.[p.id] || sock?.contacts?.[p.lid] || sock?.contacts?.[jid];

      // Lookup dari whatsapp_contacts DB
      const dbWa = waContactsMap.get(pJid) || waContactsMap.get(p.id) || waContactsMap.get(p.lid) || waContactsMap.get(cleanNumber);

      // Lookup dari batch onWhatsApp result
      const onWaInfo = businessProfileMap.get(cleanNumber);

      // Resolusi publicName: prioritas tertinggi ke terendah
      let publicName =
        cachedContact?.notify ||          // Push name dari cache Baileys
        cachedContact?.name ||             // Saved name dari cache Baileys
        cachedContact?.verifiedName ||     // Verified business name dari cache Baileys
        dbWa?.notify ||                    // Push name dari DB lokal
        dbWa?.name ||                      // Name dari DB lokal
        dbWa?.verified_name ||             // Verified name dari DB lokal
        onWaInfo?.verifiedName ||          // Verified business name dari onWhatsApp
        onWaInfo?.businessName ||          // Business description
        p.name ||                          // Nama dari metadata grup (jarang ada)
        '';

      // Resolusi savedName: jika belum ada dari contacts table, coba DB whatsapp_contacts
      if (!savedName) {
        savedName = dbWa?.name || cachedContact?.name || '';
      }

      const isBusiness = cachedContact?.isBusiness || onWaInfo?.isBusiness ? 'TRUE' : '';

      const countryInfo = getCountryInfo(cleanNumber);
      const formatted = formatPhoneNumber(cleanNumber);

      uniqueParticipantsMap.set(cleanNumber, {
        countryCode: countryInfo.code,
        countryName: countryInfo.name,
        phoneNumber: "'+" + cleanNumber,
        formattedPhone: formatted,
        myContact: savedName ? 'TRUE' : 'FALSE',
        savedName: savedName,
        publicName: publicName,
        isBusiness: isBusiness,
        isBlocked: 'FALSE',
        labels: '',
        lastMsgText: '',
        lastMsgDate: '',
        lastMsgType: '',
        lastMsgUnreadStatus: ''
      });
    }

    // Jika format yang diminta adalah JSON, kembalikan objek JSON dengan variabel/key yang sama
    const format = req.body.format || 'csv';
    if (format === 'txt') {
      let index = 1;
      const txtLines = [];
      uniqueParticipantsMap.forEach((p, cleanNumber) => {
        if (p.countryName === 'Masked User (WhatsApp Privacy)') return;
        txtLines.push(`johndoe${index},${cleanNumber},`);
        index++;
      });
      const txtContent = txtLines.join('\n');

      let filename = 'ExportWAContacts';
      if (selectedGroups.length === 1) {
        const safeSubject = selectedGroups[0].subject.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
        filename = `ExportWAContacts_${safeSubject}`;
      } else {
        filename = 'ExportWAContacts_MultipleGroups';
      }

      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}_${Date.now()}.txt`);
      return res.send(txtContent);
    }

    if (format === 'json') {
      const jsonParticipants = Array.from(uniqueParticipantsMap.values()).map(p => {
        return {
          countryCode: p.countryCode,
          countryName: p.countryName,
          phoneNumber: p.phoneNumber.startsWith("'+") ? p.phoneNumber.slice(1) : p.phoneNumber,
          formattedPhone: p.formattedPhone,
          myContact: p.myContact,
          savedName: p.savedName,
          publicName: p.publicName,
          isBusiness: p.isBusiness,
          isBlocked: p.isBlocked,
          labels: p.labels,
          lastMsgText: p.lastMsgText,
          lastMsgDate: p.lastMsgDate,
          lastMsgType: p.lastMsgType,
          lastMsgUnreadStatus: p.lastMsgUnreadStatus
        };
      });

      let filename = 'ExportWAContacts';
      if (selectedGroups.length === 1) {
        const safeSubject = selectedGroups[0].subject.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
        filename = `ExportWAContacts_${safeSubject}`;
      } else {
        filename = 'ExportWAContacts_MultipleGroups';
      }

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}_${Date.now()}.json`);
      return res.send(JSON.stringify(jsonParticipants, null, 2));
    }

    // Generate CSV content
    const headers = [
      'country code',
      'country name',
      'phone number',
      'formatted phone',
      'my contact',
      'saved name',
      'public name',
      'is business',
      'is blocked',
      'labels',
      'last msg text',
      'last msg date',
      'last msg type',
      'last msg unread status'
    ];

    const csvRows = [headers.join(',')];
    uniqueParticipantsMap.forEach(p => {
      const row = [
        escapeCSV(p.countryCode),
        escapeCSV(p.countryName),
        escapeCSV(p.phoneNumber),
        escapeCSV(p.formattedPhone),
        escapeCSV(p.myContact),
        escapeCSV(p.savedName),
        escapeCSV(p.publicName),
        escapeCSV(p.isBusiness),
        escapeCSV(p.isBlocked),
        escapeCSV(p.labels),
        escapeCSV(p.lastMsgText),
        escapeCSV(p.lastMsgDate),
        escapeCSV(p.lastMsgType),
        escapeCSV(p.lastMsgUnreadStatus)
      ];
      csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');
    let filename = 'ExportWAContacts';
    if (selectedGroups.length === 1) {
      const safeSubject = selectedGroups[0].subject.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
      filename = `ExportWAContacts_${safeSubject}`;
    } else {
      filename = 'ExportWAContacts_MultipleGroups';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}_${Date.now()}.csv`);
    res.send(csvContent);

  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
};
