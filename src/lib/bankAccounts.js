// Bank accounts shown on the public /pay page and the landing page (and behind the QR code).
// Account numbers are kept as text so leading zeros are never lost. To add, change or remove an
// account, edit this list; the pages and the copy buttons follow it.
//
// `label` is the short name the account is known by. `holder` and `branch` are optional and are
// only shown when set.
export const BANK_ACCOUNTS = [
  { id: 'hnb-jaffna', logo: '/bank-logos/hnb.png', label: 'Manien', bank: 'Hatton National Bank PLC', holder: 'Sabeskaran T', branch: 'Jaffna Metro', accountNumber: '016020849741' },
  { id: 'commercial', logo: '/bank-logos/commercial.svg', label: 'sabesh', bank: 'Commercial Bank PLC', accountNumber: '8019421328' },
  { id: 'sampath', logo: '/bank-logos/sampath.jpg', label: 'sabesh sampath', bank: 'Sampath Bank PLC', accountNumber: '117152820232' },
  { id: 'boc', logo: '/bank-logos/boc.svg', label: 'sabesh boc', bank: 'Bank of Ceylon', accountNumber: '0096879787' },
  { id: 'lb-finance', logo: '/bank-logos/lb-finance.svg', label: 'sabesh LB finance', bank: 'LB Finance PLC', accountNumber: '106014286040' },
  { id: 'hnb-company', logo: '/bank-logos/hnb.png', label: 'Sabesh company HN B', bank: 'Hatton National Bank PLC', accountNumber: '016010029252' }
];

// The accounts as plain text for a WhatsApp message (Tamil heading, as the chit notices are Tamil),
// ending with the link to the page where each number can be copied with one tap.
// *text* is bold in WhatsApp.
export function formatBankDetailsText(accounts = BANK_ACCOUNTS, payUrl) {
  const blocks = accounts.map((a) => [
    `*${a.bank}*`,
    a.holder || null,
    a.branch ? `${a.branch} branch` : null,
    a.accountNumber
  ].filter(Boolean).join('\n'));
  const lines = ['🏦 வங்கி கணக்கு விவரங்கள்:', '', blocks.join('\n\n')];
  if (payUrl) lines.push('', '📲 கணக்கு எண்களை நகலெடுக்க:', payUrl);
  return lines.join('\n');
}
