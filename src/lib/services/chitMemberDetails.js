import db from '../db.js';
import { isValidSriLankanNIC } from '../loanSchedule.js';
import { validateImageDataUrl, validateImageDataUrlArray } from './image.js';
import { normalizePhone } from '../phone.js';

export class ChitDetailsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const PHOTO_HELP = 'Upload valid JPEG/PNG/WebP images, each under 4MB.';
const NIC_HELP = 'format looks wrong — use 9 digits with V/X (e.g. 123456789V) or 12 digits.';

// Validates a chit member's own details: NIC and address are required, the
// NIC photos (up to 4) and the member's photo are optional. For an update,
// pass `existing` so photo fields left out of the payload keep their stored
// values (send `null`/[] explicitly to clear them).
export function cleanMemberDetails(input, existing = null) {
  const d = input || {};
  const nic = String(d.nic_number || '').trim().toUpperCase();
  const address = String(d.address || '').trim();

  if (!nic) throw new ChitDetailsError(400, "The member's NIC number is required.");
  if (!isValidSriLankanNIC(nic)) throw new ChitDetailsError(400, `The member's NIC number ${NIC_HELP}`);
  if (!address) throw new ChitDetailsError(400, "The member's address is required.");

  const row = { nic_number: nic, address };

  if (d.nic_photos !== undefined) {
    if (Array.isArray(d.nic_photos) && d.nic_photos.length > 0) {
      const urls = validateImageDataUrlArray(d.nic_photos);
      if (!urls) throw new ChitDetailsError(400, `The NIC photos could not be processed (up to 4). ${PHOTO_HELP}`);
      row.nic_photo_urls = JSON.stringify(urls);
    } else {
      row.nic_photo_urls = null;
    }
  } else if (!existing) {
    row.nic_photo_urls = null;
  }

  if (d.photo !== undefined) {
    if (d.photo) {
      const url = validateImageDataUrl(d.photo);
      if (!url) throw new ChitDetailsError(400, `The member's photo could not be processed. ${PHOTO_HELP}`);
      row.photo_url = url;
    } else {
      row.photo_url = null;
    }
  } else if (!existing) {
    row.photo_url = null;
  }

  return row;
}

// The optional guarantor is just a NIC number and a phone number.
export function cleanGuarantor(input) {
  const g = input || {};
  const nic = String(g.nic_number || '').trim().toUpperCase();
  const phone = String(g.phone || '').trim();

  if (!nic) throw new ChitDetailsError(400, "The guarantor's NIC number is required (or leave the guarantor out).");
  if (!isValidSriLankanNIC(nic)) throw new ChitDetailsError(400, `The guarantor's NIC number ${NIC_HELP}`);
  if (!phone) throw new ChitDetailsError(400, "The guarantor's phone number is required (or leave the guarantor out).");
  if (normalizePhone(phone).length < 9) throw new ChitDetailsError(400, "The guarantor's phone number looks wrong — it needs at least 9 digits.");
  if (phone.length > 30) throw new ChitDetailsError(400, "The guarantor's phone number is too long.");
  return { nic_number: nic, phone };
}

export async function getMemberDetails(ticketId, memberId) {
  const details = await db('ticket_member_details').where({ ticket_id: ticketId, member_id: memberId }).first();
  const guarantor = await db('ticket_member_guarantors').where({ ticket_id: ticketId, member_id: memberId }).first();
  return { details: details || null, guarantor: guarantor || null };
}

// Saves what is present in `payload`:
//   details   — undefined: leave alone; object: add / replace the member's details
//   guarantor — undefined: leave alone; null: remove; object: add / replace
// Run inside a transaction (pass `trx`) so the pieces are saved together.
export async function saveMemberDetails(ticketId, memberId, payload, trx = db) {
  const out = { details: undefined, guarantor: undefined, detailsCreated: false, guarantorCreated: false, guarantorRemoved: false };

  if (payload.details !== undefined && payload.details !== null) {
    const existing = await trx('ticket_member_details').where({ ticket_id: ticketId, member_id: memberId }).first();
    const row = cleanMemberDetails(payload.details, existing);
    if (existing) {
      [out.details] = await trx('ticket_member_details').where({ id: existing.id }).update({ ...row, updated_at: db.fn.now() }).returning('*');
    } else {
      [out.details] = await trx('ticket_member_details').insert({ ticket_id: ticketId, member_id: memberId, ...row }).returning('*');
      out.detailsCreated = true;
    }
  }

  if (payload.guarantor === null) {
    out.guarantorRemoved = (await trx('ticket_member_guarantors').where({ ticket_id: ticketId, member_id: memberId }).del()) > 0;
  } else if (payload.guarantor !== undefined) {
    const row = cleanGuarantor(payload.guarantor);
    const existing = await trx('ticket_member_guarantors').where({ ticket_id: ticketId, member_id: memberId }).first();
    if (existing) {
      [out.guarantor] = await trx('ticket_member_guarantors').where({ id: existing.id }).update({ ...row, updated_at: db.fn.now() }).returning('*');
    } else {
      [out.guarantor] = await trx('ticket_member_guarantors').insert({ ticket_id: ticketId, member_id: memberId, ...row }).returning('*');
      out.guarantorCreated = true;
    }
  }
  return out;
}
