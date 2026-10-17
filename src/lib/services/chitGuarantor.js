import db from '../db.js';
import { isValidSriLankanNIC } from '../loanSchedule.js';
import { validateImageDataUrl, validateImageDataUrlArray } from './image.js';
import { normalizePhone } from '../phone.js';

export class ChitGuarantorError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const PHOTO_HELP = 'Upload valid JPEG/PNG/WebP images, each under 4MB.';

// Validates a guarantor payload and returns the cleaned row fields.
// name, NIC, phone and address are required; photos are optional.
// For an update, pass `existing` so photo fields left out of the payload keep
// their stored values (send `null`/[] explicitly to clear them).
export function cleanGuarantor(input, existing = null) {
  const g = input || {};
  const full_name = String(g.full_name || '').trim();
  const nic = String(g.nic_number || '').trim().toUpperCase();
  const phone = String(g.phone || '').trim();
  const address = String(g.address || '').trim();

  if (!full_name) throw new ChitGuarantorError(400, "The guarantor's name is required.");
  if (full_name.length > 150) throw new ChitGuarantorError(400, "The guarantor's name must be 150 characters or fewer.");
  if (!nic) throw new ChitGuarantorError(400, "The guarantor's NIC number is required.");
  if (!isValidSriLankanNIC(nic)) {
    throw new ChitGuarantorError(400, "The guarantor's NIC number format looks wrong — use 9 digits with V/X (e.g. 123456789V) or 12 digits.");
  }
  if (!phone) throw new ChitGuarantorError(400, "The guarantor's phone number is required.");
  if (normalizePhone(phone).length < 9) throw new ChitGuarantorError(400, "The guarantor's phone number looks wrong — it needs at least 9 digits.");
  if (phone.length > 30) throw new ChitGuarantorError(400, "The guarantor's phone number is too long.");
  if (!address) throw new ChitGuarantorError(400, "The guarantor's address is required.");

  const row = { full_name, nic_number: nic, phone, address };

  if (g.nic_photos !== undefined) {
    if (Array.isArray(g.nic_photos) && g.nic_photos.length > 0) {
      const urls = validateImageDataUrlArray(g.nic_photos);
      if (!urls) throw new ChitGuarantorError(400, `The guarantor's NIC photos could not be processed (up to 4). ${PHOTO_HELP}`);
      row.nic_photo_urls = JSON.stringify(urls);
    } else {
      row.nic_photo_urls = null;
    }
  } else if (!existing) {
    row.nic_photo_urls = null;
  }

  if (g.photo !== undefined) {
    if (g.photo) {
      const url = validateImageDataUrl(g.photo);
      if (!url) throw new ChitGuarantorError(400, `The guarantor's photo could not be processed. ${PHOTO_HELP}`);
      row.photo_url = url;
    } else {
      row.photo_url = null;
    }
  } else if (!existing) {
    row.photo_url = null;
  }

  return row;
}

export async function getGuarantor(ticketId, memberId) {
  const row = await db('ticket_member_guarantors').where({ ticket_id: ticketId, member_id: memberId }).first();
  return row || null;
}

export async function upsertGuarantor(ticketId, memberId, input, trx = db) {
  const existing = await trx('ticket_member_guarantors').where({ ticket_id: ticketId, member_id: memberId }).first();
  const row = cleanGuarantor(input, existing);
  if (existing) {
    const [updated] = await trx('ticket_member_guarantors').where({ id: existing.id }).update({ ...row, updated_at: db.fn.now() }).returning('*');
    return { guarantor: updated, created: false };
  }
  const [created] = await trx('ticket_member_guarantors').insert({ ticket_id: ticketId, member_id: memberId, ...row }).returning('*');
  return { guarantor: created, created: true };
}
