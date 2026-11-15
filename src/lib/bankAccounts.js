// Bank accounts shown on the public /pay page and the landing page (and behind the QR code).
// Account numbers are kept as text so leading zeros are never lost. To add, change or remove an
// account, edit this list; the pages and the copy buttons follow it.
//
// `label` is the short name the account is known by. `holder` and `branch` are optional and are
// only shown when set.
export const BANK_ACCOUNTS = [
  { id: 'commercial', label: 'sabesh', bank: 'Commercial Bank PLC', accountNumber: '8019421328' },
  { id: 'boc', label: 'sabesh boc', bank: 'Bank of Ceylon', accountNumber: '0096879787' },
  { id: 'hnb-company', label: 'Sabesh company HN B', bank: 'Hatton National Bank PLC', accountNumber: '016010029252' },
  { id: 'lb-finance', label: 'sabesh LB finance', bank: 'LB Finance PLC', accountNumber: '106014286040' },
  { id: 'sampath', label: 'sabesh sampath', bank: 'Sampath Bank PLC', accountNumber: '117152820232' },
  { id: 'hnb-jaffna', label: 'Manien', bank: 'Hatton National Bank PLC', holder: 'Sabeskaran T', branch: 'Jaffna Metro', accountNumber: '016020849741' }
];
