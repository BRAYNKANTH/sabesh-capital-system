import LandingPage from '@/components/LandingPage.jsx';

export const metadata = {
  description: 'Loans, chit funds and pawn services. Apply online and find our bank details.'
};

// The landing page on its own address, so signed-in staff can still open and share it
// ("/" takes signed-in staff straight to the app).
export default function WelcomePage() {
  return <LandingPage />;
}
