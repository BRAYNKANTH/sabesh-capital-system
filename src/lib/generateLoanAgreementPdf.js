'use client';

import { jsPDF } from 'jspdf';

// Loads a static asset (served from /public) as a PNG data URL so jsPDF can
// embed it — jsPDF's addImage() needs either a data URL or a canvas/image
// element, not a bare path, and the browser fetch+canvas round trip is the
// standard client-side way to get there without a server round trip.
function loadImageAsDataUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

const COLORS = {
  ink: [26, 26, 26],
  muted: [100, 108, 122],
  accent: [37, 84, 232],
  boxBg: [244, 247, 253],
  boxBorder: [211, 222, 245]
};

/**
 * Builds a formatted, downloadable Loan Agreement PDF (with the company
 * logo) from the same loanStatement shape already used by the on-screen
 * agreement modal ({ loan, guarantors } — a loan can have more than one,
 * one per borrower dependent). Falls back to the older singular `guarantor`
 * field for backward compatibility. Triggers a browser download; runs
 * entirely client-side, no server round trip or headless-browser infra
 * needed on Vercel.
 *
 * `orgSettings` ({ org_name, logo_url }) comes from GET /api/settings —
 * this org's own branding, read from their own database, rather than a
 * hardcoded company name/logo — so the exact same function produces a
 * correctly-branded agreement no matter which organization's deployment
 * it runs in. Falls back to a generic name/no logo if not provided.
 */
export async function downloadLoanAgreementPdf(loanStatement, orgSettings = {}) {
  const { loan } = loanStatement;
  const guarantors = loanStatement.guarantors || (loanStatement.guarantor ? [loanStatement.guarantor] : []);
  const orgName = orgSettings.org_name || 'This Company';
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 54;
  const contentWidth = pageWidth - marginX * 2;
  const footerY = pageHeight - 36;
  let y = 54;
  let pageNum = 1;

  const drawFooter = () => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text(`${orgName} — System-generated loan agreement`, marginX, footerY);
    doc.text(`Page ${pageNum}`, pageWidth - marginX, footerY, { align: 'right' });
  };

  // Ensures upcoming content has room before the footer; starts a fresh
  // page (with its own footer) if it doesn't.
  const ensureSpace = (needed) => {
    if (y + needed > footerY - 10) {
      drawFooter();
      doc.addPage();
      pageNum += 1;
      y = 54;
    }
  };

  // --- Header: logo + company name ---
  if (orgSettings.logo_url) {
    try {
      let logoDataUrl, logoFormat;
      if (orgSettings.logo_url.startsWith('data:')) {
        // Uploaded via Settings — jsPDF can embed it directly, but its
        // format argument has to match the actual image data (JPEG, PNG,
        // or WebP, per what the upload form accepts) rather than being
        // hardcoded, or jsPDF fails to decode it.
        logoDataUrl = orgSettings.logo_url;
        const mimeMatch = orgSettings.logo_url.match(/^data:image\/(png|jpe?g|webp)/i);
        logoFormat = mimeMatch ? mimeMatch[1].toUpperCase().replace('JPG', 'JPEG') : 'PNG';
      } else {
        // Hosted URL — loadImageAsDataUrl always normalizes to PNG via canvas.
        logoDataUrl = await loadImageAsDataUrl(orgSettings.logo_url);
        logoFormat = 'PNG';
      }
      doc.addImage(logoDataUrl, logoFormat, marginX, y, 52, 52);
    } catch {
      // Logo failed to load (offline, blocked, unsupported format, etc.) —
      // proceed text-only rather than failing the whole download.
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...COLORS.ink);
  doc.text(orgName.toUpperCase(), marginX + 64, y + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.muted);
  doc.text('Cash Lending & Micro Credit Services', marginX + 64, y + 37);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.muted);
  doc.text(`Ref: ${loan.reference_number || `LN-${String(loan.id).padStart(3, '0')}`}`, pageWidth - marginX, y + 22, { align: 'right' });
  doc.text(`Date: ${new Date(loan.created_at).toLocaleDateString()}`, pageWidth - marginX, y + 37, { align: 'right' });

  y += 66;
  doc.setDrawColor(...COLORS.accent);
  doc.setLineWidth(1.4);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 30;

  // --- Title ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...COLORS.ink);
  doc.text('LOAN AGREEMENT', pageWidth / 2, y, { align: 'center' });
  y += 26;

  // --- Intro paragraph ---
  const dobText = loan.date_of_birth ? `, Date of Birth: ${new Date(loan.date_of_birth).toLocaleDateString()}` : '';
  const introText = `This agreement is entered into on ${new Date(loan.created_at).toLocaleDateString()} between ${orgName} (the "Lender") and ${loan.borrower_name} (NIC: ${loan.nic_number || 'N/A'}${dobText}, Address: ${loan.borrower_address || 'N/A'}) (the "Borrower").`;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(...COLORS.ink);
  const introLines = doc.splitTextToSize(introText, contentWidth);
  doc.text(introLines, marginX, y);
  y += introLines.length * 14 + 18;

  // --- Key facts box ---
  const facts = loan.is_flat_installment
    ? [
        ['Principal Amount', `LKR ${parseFloat(loan.principal_amount).toLocaleString()}`],
        ['Daily Installment', `LKR ${parseFloat(loan.daily_installment_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
        ['Collection Frequency', 'Daily (Flat Installment)'],
        ['Loan Term', `${loan.duration_periods || '-'} days`],
      ]
    : [
        ['Principal Amount', `LKR ${parseFloat(loan.principal_amount).toLocaleString()}`],
        ['Interest Rate', `${loan.interest_rate}%`],
        ['Collection Frequency', loan.interest_type === 'daily' ? 'Daily' : loan.interest_type === 'weekly' ? 'Weekly' : 'Monthly'],
        ['Loan Term', loan.collection_mode === 'fixed_term' ? `Fixed Term (${loan.duration_periods || '-'} periods)` : 'Open-Ended'],
      ];
  const boxHeight = Math.ceil(facts.length / 2) * 24 + 20;
  ensureSpace(boxHeight + 10);
  doc.setFillColor(...COLORS.boxBg);
  doc.setDrawColor(...COLORS.boxBorder);
  doc.roundedRect(marginX, y, contentWidth, boxHeight, 4, 4, 'FD');
  const colW = contentWidth / 2;
  facts.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const fx = marginX + 16 + col * colW;
    const fy = y + 22 + row * 24;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.muted);
    doc.text(label.toUpperCase(), fx, fy);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...COLORS.ink);
    doc.text(value, fx, fy + 13);
  });
  y += boxHeight + 26;

  // --- Numbered clauses ---
  let clauseNum = 1;
  const addClause = (title, body) => {
    ensureSpace(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...COLORS.ink);
    doc.text(`${clauseNum}. ${title}`, marginX, y);
    y += 15;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(60, 60, 60);
    const lines = doc.splitTextToSize(body, contentWidth);
    ensureSpace(lines.length * 13 + 14);
    doc.text(lines, marginX, y);
    y += lines.length * 13 + 18;
    clauseNum += 1;
  };

  addClause(
    'Loan Amount',
    `The Lender agrees to give the Borrower a loan of LKR ${parseFloat(loan.principal_amount).toLocaleString()}.`
  );

  if (loan.is_flat_installment) {
    const dailyAmt = parseFloat(loan.daily_installment_amount || 0);
    const durationDays = loan.duration_periods || 0;
    const numMonths = durationDays ? Math.round(durationDays / 31) : 0;
    const nominalDays = durationDays - numMonths;
    const totalRepayable = dailyAmt * durationDays;
    addClause(
      'Daily Installment & Repayment',
      `A flat daily installment of LKR ${dailyAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (covering both principal and interest together) is payable each day, starting on the date of disbursement, for a total of ${durationDays} collection days (${nominalDays} nominal days at ${loan.interest_rate}% per month over ${numMonths} month(s), plus ${durationDays - nominalDays} additional collection day(s) charged at the same daily rate). The total amount repayable over the full term is LKR ${totalRepayable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. The loan is considered fully settled once all ${durationDays} days' installments have been paid in full.`
    );
  } else {
    addClause(
      'Interest & Repayment',
      `Interest is charged at ${loan.interest_rate}% of the principal, payable every ${loan.interest_type === 'daily' ? 'day' : loan.interest_type === 'weekly' ? 'week' : 'month'}. The principal amount remains payable in full (or in part, at the Borrower's discretion) at any time; the loan is considered settled once the full principal of LKR ${parseFloat(loan.principal_amount).toLocaleString()} has been repaid, regardless of the interest payment schedule.`
    );
  }

  if (loan.loan_purpose) {
    addClause('Purpose of Loan', loan.loan_purpose);
  }

  guarantors.forEach((guarantor, gi) => {
    addClause(
      guarantors.length > 1 ? `Guarantor ${gi + 1}` : 'Guarantor',
      `${guarantor.full_name} (NIC: ${guarantor.nic_number}), residing at ${guarantor.address}, stands as guarantor for this loan and accepts joint responsibility for repayment in the event the Borrower defaults.`
    );
  });

  addClause(
    'Default',
    'If the Borrower fails to pay interest or repay the principal as agreed, the Lender has the right to take legal action to recover the outstanding amount.'
  );

  addClause(
    'Declaration',
    'Both parties confirm they have read, understood, and agree to all the terms stated above.'
  );

  // --- Signature block --- wraps into rows of up to 3 columns so it stays
  // legible even with several guarantors (one per dependent).
  const signatories = [
    { role: 'Lender', name: orgName },
    { role: 'Borrower', name: loan.borrower_name },
    ...guarantors.map((g, gi) => ({ role: guarantors.length > 1 ? `Guarantor ${gi + 1}` : 'Guarantor', name: g.full_name }))
  ];
  const sigCols = Math.min(3, signatories.length);
  const sigColWidth = contentWidth / sigCols;
  const sigRowHeight = 55;
  ensureSpace(Math.ceil(signatories.length / sigCols) * sigRowHeight + 20);
  y += 20;
  signatories.forEach((s, i) => {
    const col = i % sigCols;
    const row = Math.floor(i / sigCols);
    const sx = marginX + col * sigColWidth;
    const sy = y + row * sigRowHeight;
    doc.setDrawColor(...COLORS.ink);
    doc.setLineWidth(0.7);
    doc.line(sx, sy, sx + sigColWidth - 20, sy);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.ink);
    doc.text(s.role, sx, sy + 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.muted);
    const nameLines = doc.splitTextToSize(s.name, sigColWidth - 20);
    doc.text(nameLines, sx, sy + 27);
    doc.text('Date: _______________', sx, sy + 27 + nameLines.length * 11 + 12);
  });

  drawFooter();

  const fileRef = loan.reference_number || `LN-${String(loan.id).padStart(3, '0')}`;
  const safeBorrowerName = (loan.borrower_name || 'Borrower').replace(/[^a-z0-9]+/gi, '-');
  doc.save(`Loan-Agreement-${fileRef}-${safeBorrowerName}.pdf`);
}
