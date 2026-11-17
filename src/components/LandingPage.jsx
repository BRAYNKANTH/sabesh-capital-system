'use client';

import React from 'react';
import { Coins, Gem, Landmark, Phone, Mail, MapPin, MessageCircle, ShieldCheck, Languages, Smartphone, ArrowRight } from 'lucide-react';
import BankAccountList from './BankAccountList.jsx';
import BankQr from './BankQr.jsx';
import useOrgName from './useOrgName.js';
import { openWhatsApp } from '@/lib/whatsapp.js';
import styles from './landing.module.css';

const CONTACT = {
  phoneDisplay: '+94 77 527 2035',
  phoneTel: '+94775272035',
  phoneWhatsapp: '94775272035',
  email: 'Sabesh2222@gmail.com',
  addressLines: ['No-04, Pereyathodam,', 'Maniyanthodam, Jaffna.']
};
const MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('No 4 Pereyathodam Maniyanthodam Jaffna')}`;

const SERVICES = [
  { Icon: Landmark, title: 'Loans', text: 'Daily, weekly and monthly collection loans, and cheque loans. Your agent collects and records every payment.' },
  { Icon: Coins, title: 'Chit funds', text: 'Join a chit group and pay your instalment each round. Rounds, payouts and balances are tracked for every member.' },
  { Icon: Gem, title: 'Pawn loans', text: 'Borrow against gold jewellery or a vehicle. Interest is tracked, and your item is returned when the loan is settled.' }
];

const STEPS = [
  { title: 'Apply', text: 'Fill in the short online form, in English or Tamil.' },
  { title: 'Confirm', text: 'An agent contacts you to confirm the details and complete your documents.' },
  { title: 'Repay', text: 'Pay your agent, or send a bank transfer to one of the accounts below.' }
];

const TRUST = [
  { Icon: ShieldCheck, text: 'Every payment recorded' },
  { Icon: Languages, text: 'Apply in English or Tamil' },
  { Icon: Smartphone, text: 'Works on any phone' }
];

// The S-in-a-circle mark from the business card.
function LogoMark({ size = 64 }) {
  return (
    <svg className={styles.logoMark} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Sabesh Capital logo">
      <defs>
        <linearGradient id="lm-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6c25b" />
          <stop offset="1" stopColor="#d9791f" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="31" fill="#12172b" />
      <circle cx="32" cy="32" r="29" fill="none" stroke="url(#lm-gold)" strokeWidth="1.5" />
      <text x="30" y="43" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontWeight="700" fontSize="36" fill="url(#lm-gold)">S</text>
      <path d="M38 22 L52 12 M46 11.5 L52.5 11.5 L52.5 18" fill="none" stroke="url(#lm-gold)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The business card, as a banner.
function CardBanner({ orgName }) {
  const [first, ...rest] = orgName.trim().split(/\s+/);
  const second = rest.join(' ');
  return (
    <div className={styles.card3d}>
      <article className={styles.bizCard} aria-label={`${orgName} contact card`}>
        <span className={styles.bizSwooshTop} aria-hidden="true" />
        <span className={styles.bizSwooshSide} aria-hidden="true" />
        <span className={styles.bizStripe} aria-hidden="true" />
        <div className={styles.bizHead}>
          <LogoMark size={72} />
          <div className={styles.bizName}>
            <span className={styles.bizNameMain}>{first}</span>
            {second && <span className={styles.bizNameSub}>{second}</span>}
          </div>
        </div>
        <hr className={styles.bizRule} />
        <ul className={styles.bizList}>
          <li><span className={styles.bizIcon}><Phone size={15} aria-hidden="true" /></span><a href={`tel:${CONTACT.phoneTel}`}>{CONTACT.phoneDisplay}</a></li>
          <li><span className={styles.bizIcon}><Mail size={15} aria-hidden="true" /></span><a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></li>
          <li><span className={styles.bizIcon}><MapPin size={15} aria-hidden="true" /></span><a href={MAPS_URL} target="_blank" rel="noopener noreferrer">{CONTACT.addressLines.map((l, i) => <span key={l}>{i > 0 && <br />}{l}</span>)}</a></li>
        </ul>
      </article>
    </div>
  );
}

// The public landing page: what we offer, how to apply, contact details and the bank accounts (with a QR code).
export default function LandingPage() {
  const orgName = useOrgName();
  const year = new Date().getFullYear();

  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">Skip to content</a>
      <div className={styles.wrap}>
        <header className={styles.topbar}>
          <a className={styles.brand} href="/welcome" aria-label={`${orgName} home`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.brandLogo} src="/api/org-icon?size=96" width={44} height={44} alt="" />
            <span>{orgName}</span>
          </a>
          <nav className={styles.nav} aria-label="Main">
            <a className={styles.navLink} href="#contact">Contact</a>
            <a className={styles.navLink} href="#pay">Bank details</a>
            <a className={`${styles.btn} ${styles.btnGhost}`} href="/?login=1">Staff login</a>
          </nav>
        </header>

        <main id="main">
          <section className={styles.heroPanel} aria-labelledby="hero-title">
            <span className={styles.heroGlow} aria-hidden="true" />
            <span className={styles.heroArc} aria-hidden="true" />
            <div className={styles.heroCopy}>
              <p className={styles.heroEyebrow}>Loans · Chit funds · Pawn</p>
              <h1 id="hero-title" className={styles.heroH1}>
                Trusted lending,<br /><span className={styles.heroAccent}>every payment recorded.</span>
              </h1>
              <p className={styles.heroLead}>
                {orgName} offers loans, chit funds and pawn services from Jaffna. Apply online, then repay through your collection agent or by bank transfer.
              </p>
              <div className={styles.ctaRow2}>
                <a className={`${styles.btn} ${styles.btnGold}`} href="/apply">Apply for a loan <ArrowRight size={18} aria-hidden="true" /></a>
                <a className={`${styles.btn} ${styles.btnOutline}`} href={`tel:${CONTACT.phoneTel}`}><Phone size={18} aria-hidden="true" /> Call us</a>
              </div>
            </div>
            <div className={styles.heroCard}>
              <CardBanner orgName={orgName} />
            </div>
          </section>

          <ul className={styles.trust} aria-label="Why customers choose us">
            {TRUST.map(({ Icon, text }) => (
              <li key={text} className={styles.trustItem}><Icon size={20} aria-hidden="true" />{text}</li>
            ))}
          </ul>

          <section className={`${styles.section} ${styles.reveal}`} aria-labelledby="services-title">
            <h2 id="services-title" className={styles.sectionTitle}>What we offer</h2>
            <p className={styles.sectionLead}>Three services, one place for your records.</p>
            <ul className={styles.cards}>
              {SERVICES.map(({ Icon, title, text }) => (
                <li key={title} className={`${styles.card} ${styles.lift}`}>
                  <div className={styles.cardIcon}><Icon size={26} aria-hidden="true" /></div>
                  <h3 className={styles.cardTitle}>{title}</h3>
                  <p className={styles.cardText}>{text}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className={`${styles.section} ${styles.reveal}`} aria-labelledby="steps-title">
            <h2 id="steps-title" className={styles.sectionTitle}>How it works</h2>
            <p className={styles.sectionLead}>Three simple steps.</p>
            <ol className={`${styles.cards} ${styles.steps}`}>
              {STEPS.map((s, i) => (
                <li key={s.title} className={`${styles.card} ${styles.step} ${styles.lift}`}>
                  <span className={styles.stepNum} aria-hidden="true">{i + 1}</span>
                  <h3 className={styles.cardTitle}><span className={styles.srOnly}>Step {i + 1}: </span>{s.title}</h3>
                  <p className={styles.cardText}>{s.text}</p>
                </li>
              ))}
            </ol>
          </section>

          <section id="pay" className={`${styles.section} ${styles.reveal}`} aria-labelledby="pay-title">
            <h2 id="pay-title" className={styles.sectionTitle}>Pay by bank transfer</h2>
            <p className={styles.sectionLead}>
              Scan the QR code with your phone camera to open this list on your phone. Tap <strong>Copy number</strong>, then paste it into your banking app.
            </p>
            <div className={styles.payGrid}>
              <BankQr />
              <div>
                <p className={styles.payNote}>After you send money, keep the transfer slip and tell your agent, so the payment can be recorded.</p>
                <BankAccountList />
              </div>
            </div>
          </section>

          <section id="contact" className={`${styles.section} ${styles.reveal}`} aria-labelledby="contact-title">
            <h2 id="contact-title" className={styles.sectionTitle}>Contact us</h2>
            <p className={styles.sectionLead}>Call, message or visit our office in Jaffna.</p>
            <div className={styles.contactGrid}>
              <a className={`${styles.contactTile} ${styles.lift}`} href={`tel:${CONTACT.phoneTel}`}>
                <span className={styles.cardIcon}><Phone size={24} aria-hidden="true" /></span>
                <span className={styles.contactLabel}>Call</span>
                <span className={styles.contactValue}>{CONTACT.phoneDisplay}</span>
              </a>
              <a className={`${styles.contactTile} ${styles.lift}`} href={`https://wa.me/${CONTACT.phoneWhatsapp}`} onClick={(e) => { e.preventDefault(); openWhatsApp({ phone: CONTACT.phoneWhatsapp }); }} target="_blank" rel="noopener noreferrer">
                <span className={styles.cardIcon}><MessageCircle size={24} aria-hidden="true" /></span>
                <span className={styles.contactLabel}>WhatsApp</span>
                <span className={styles.contactValue}>{CONTACT.phoneDisplay}</span>
              </a>
              <a className={`${styles.contactTile} ${styles.lift}`} href={`mailto:${CONTACT.email}`}>
                <span className={styles.cardIcon}><Mail size={24} aria-hidden="true" /></span>
                <span className={styles.contactLabel}>Email</span>
                <span className={styles.contactValue}>{CONTACT.email}</span>
              </a>
              <a className={`${styles.contactTile} ${styles.lift}`} href={MAPS_URL} target="_blank" rel="noopener noreferrer">
                <span className={styles.cardIcon}><MapPin size={24} aria-hidden="true" /></span>
                <span className={styles.contactLabel}>Visit</span>
                <span className={styles.contactValue}>{CONTACT.addressLines.join(' ')}</span>
              </a>
            </div>
          </section>
        </main>

        <footer className={styles.footer}>
          <div className={styles.footerLinks}>
            <a className={styles.navLink} href="/apply">Apply for a loan</a>
            <a className={styles.navLink} href="/pay">Bank details</a>
            <a className={styles.navLink} href="/?login=1">Staff login</a>
          </div>
          <div>© {year} {orgName}</div>
        </footer>
      </div>
    </div>
  );
}
