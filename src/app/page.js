import LandingGate from '@/components/LandingGate.jsx';

// "/" is the public landing page for visitors and the staff app for signed-in staff
// (see LandingGate). "/?login=1" always opens the app's sign-in.
export default function Page({ searchParams }) {
  return <LandingGate openApp={searchParams?.login !== undefined} />;
}
