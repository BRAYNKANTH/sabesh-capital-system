'use client';

import React from 'react';

// Printable pawn ticket — mirrors the company's paper pawn form, in English
// or Tamil. Printing uses the .pawn-ticket-sheet rules in globals.css, which
// hide everything else on the page.

export const TICKET_TEXT = {
  en: {
    tagline: 'YOUR TRUST... OUR COMMITMENT...',
    headline1: 'PAWN LOANS FOR',
    headline2: 'VEHICLE & GOLD JEWELRY',
    customerDetails: 'CUSTOMER DETAILS',
    pawnDetails: 'PAWN DETAILS',
    ref: 'Ticket No.',
    date: 'Date',
    name: 'Name',
    fatherHusband: 'Father / Husband Name',
    address: 'Address',
    nic: 'NIC / ID No.',
    mobile: 'Mobile No.',
    occupation: 'Occupation',
    monthlyIncome: 'Monthly Income',
    referenceName: 'Reference Name',
    referencePhone: 'Reference Contact No.',
    pawnType: 'Pawn Type',
    vehicle: 'Vehicle',
    gold: 'Gold Jewelry',
    itemDescription: 'Item Description / Details',
    makeModel: 'Make / Model',
    regSerial: 'Reg. No. / Serial No.',
    goldWeight: 'Weight / Karat',
    estimatedValue: 'Estimated Value',
    loanAmount: 'Loan Amount',
    interestRate: 'Interest Rate',
    perMonth: 'per month',
    loanPeriod: 'Loan Period',
    months: 'month(s)',
    monthlyRepayment: 'Monthly Repayment (interest)',
    dueDate: 'Due Date',
    terms: 'TERMS & CONDITIONS',
    termsList: [
      'The pledged items will be kept safely and securely.',
      'The company is not responsible for any loss or damage beyond our control.',
      'Interest will be charged as per the company policy.',
      'Please repay the loan within the agreed period to avoid additional charges.'
    ],
    signature: 'Customer Signature',
    footer: 'Your Trust... Our Commitment...'
  },
  ta: {
    tagline: 'உங்கள் நம்பிக்கை... எங்கள் உறுதி...',
    headline1: 'வாகனம் அடகு வைத்தல்',
    headline2: 'மற்றும் தங்க நகை அடகு வைத்தல்',
    customerDetails: 'வாடிக்கையாளர் விவரம்',
    pawnDetails: 'அடகு விவரம்',
    ref: 'டிக்கெட் எண்',
    date: 'தேதி',
    name: 'பெயர்',
    fatherHusband: 'தந்தை / கணவர் பெயர்',
    address: 'முகவரி',
    nic: 'அடையாள அட்டை எண்',
    mobile: 'தொலைபேசி எண்',
    occupation: 'தொழில்',
    monthlyIncome: 'மாத வருமானம்',
    referenceName: 'பரிந்துரைப்பவர் பெயர்',
    referencePhone: 'பரிந்துரைப்பவர் தொலைபேசி எண்',
    pawnType: 'வகை',
    vehicle: 'வாகனம்',
    gold: 'தங்க நகை',
    itemDescription: 'பொருளின் விவரம்',
    makeModel: 'தயாரிப்பு / மாடல்',
    regSerial: 'வாகன எண் / வரிசை எண்',
    goldWeight: 'எடை / காரட்',
    estimatedValue: 'அடகு மதிப்பு',
    loanAmount: 'வழங்கப்படும் கடன் தொகை',
    interestRate: 'வட்டி விகிதம்',
    perMonth: 'மாதத்திற்கு',
    loanPeriod: 'கால அவகாசம்',
    months: 'மாதம்',
    monthlyRepayment: 'மாதாந்த வட்டி',
    dueDate: 'செலுத்த வேண்டிய தேதி',
    terms: 'விதிமுறைகள்',
    termsList: [
      'அடகு வைத்த பொருட்கள் நிறுவனத்தின் பாதுகாப்பில் வைக்கப்படும்.',
      'கால அவகாசத்திற்குள் தொகையை செலுத்த வேண்டும்.',
      'கால அவகாசத்திற்குள் செலுத்தவில்லை எனில், அடகு வைத்த பொருட்கள் ஏலத்திற்கு விடப்படும்.',
      'நிறுவனத்தின் தீர்ப்பே இறுதியானது.'
    ],
    signature: 'வாடிக்கையாளர் கையொப்பம்',
    footer: 'நம்பிக்கையுடன்... நிம்மதியான கடன்...'
  }
};

const money = (n) => `LKR ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { timeZone: 'Asia/Colombo' }) : '');

function Field({ label, value }) {
  return (
    <div className="pawn-ticket-field">
      <span className="pawn-ticket-label">{label}</span>
      <span className="pawn-ticket-colon">:</span>
      <span className="pawn-ticket-value">{value || ' '}</span>
    </div>
  );
}

export function PawnTicket({ loan, lang = 'en', orgName }) {
  const t = TICKET_TEXT[lang] || TICKET_TEXT.en;
  const isGold = loan.pawn_type === 'gold';
  const monthlyInterest = (parseFloat(loan.principal_amount) * parseFloat(loan.interest_rate)) / 100;

  return (
    <div className="pawn-ticket-sheet" lang={lang === 'ta' ? 'ta' : 'en'}>
      <div className="pawn-ticket-head">
        <div className="pawn-ticket-org">{(orgName || '').toUpperCase()}</div>
        <div className="pawn-ticket-tagline">{t.tagline}</div>
        <div className="pawn-ticket-headline">
          <div>{t.headline1}</div>
          <div>{t.headline2}</div>
        </div>
        <div className="pawn-ticket-meta">
          <span>{t.ref}: <strong>{loan.reference_number}</strong></span>
          <span>{t.date}: <strong>{fmtDate(loan.start_date)}</strong></span>
        </div>
      </div>

      <div className="pawn-ticket-columns">
        <section className="pawn-ticket-box">
          <h4>{t.customerDetails}</h4>
          <Field label={t.name} value={loan.customer_name} />
          <Field label={t.fatherHusband} value={loan.father_husband_name} />
          <Field label={t.address} value={loan.address} />
          <Field label={t.nic} value={loan.nic_number} />
          <Field label={t.mobile} value={loan.mobile} />
          <Field label={t.occupation} value={loan.occupation} />
          <Field label={t.monthlyIncome} value={loan.monthly_income ? money(loan.monthly_income) : ''} />
          <Field label={t.referenceName} value={loan.reference_name} />
          <Field label={t.referencePhone} value={loan.reference_phone} />
        </section>

        <section className="pawn-ticket-box">
          <h4>{t.pawnDetails}</h4>
          <div className="pawn-ticket-field">
            <span className="pawn-ticket-label">{t.pawnType}</span>
            <span className="pawn-ticket-colon">:</span>
            <span className="pawn-ticket-value">
              <span className="pawn-ticket-check">{!isGold ? '☑' : '☐'} {t.vehicle}</span>
              {'   '}
              <span className="pawn-ticket-check">{isGold ? '☑' : '☐'} {t.gold}</span>
            </span>
          </div>
          <Field label={t.itemDescription} value={loan.item_description} />
          {!isGold && <Field label={t.makeModel} value={loan.make_model} />}
          <Field label={t.regSerial} value={loan.registration_serial} />
          {isGold && (
            <Field
              label={t.goldWeight}
              value={[loan.gold_weight_grams ? `${Number(loan.gold_weight_grams)} g` : '', loan.gold_karat].filter(Boolean).join(' / ')}
            />
          )}
          <Field label={t.estimatedValue} value={money(loan.estimated_value)} />
          <Field label={t.loanAmount} value={money(loan.principal_amount)} />
          <Field label={t.interestRate} value={`${Number(loan.interest_rate)}% ${t.perMonth}`} />
          <Field label={t.loanPeriod} value={`${loan.period_months} ${t.months}`} />
          <Field label={t.monthlyRepayment} value={money(monthlyInterest)} />
          <Field label={t.dueDate} value={fmtDate(loan.due_date)} />
        </section>
      </div>

      <div className="pawn-ticket-bottom">
        <section className="pawn-ticket-box pawn-ticket-terms">
          <h4>{t.terms}</h4>
          <ul>
            {t.termsList.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>
        <div className="pawn-ticket-sign">
          <div className="pawn-ticket-sign-box" />
          <div className="pawn-ticket-sign-label">{t.signature}</div>
        </div>
      </div>

      <div className="pawn-ticket-footer">{t.footer}</div>
    </div>
  );
}
