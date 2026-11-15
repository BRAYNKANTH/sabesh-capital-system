import BankDetailsPage from '@/components/BankDetailsPage.jsx';

export const metadata = {
  title: 'Bank details',
  description: 'Our bank accounts, with one-tap copy for each account number.'
};

// Public page behind the QR code: bank accounts with copy buttons.
export default function PayPage() {
  return <BankDetailsPage />;
}
