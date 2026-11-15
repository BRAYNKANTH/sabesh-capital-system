'use client';

import React from 'react';
import { Coins, Gem, Landmark } from 'lucide-react';
import BankAccountList from './BankAccountList.jsx';
import BankQr from './BankQr.jsx';
import useOrgName from './useOrgName.js';
import styles from './landing.module.css';

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

// The public landing page: what we offer, how to apply, and the bank accounts (with a QR code).
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
            <a className={styles.navLink} href="#pay">Bank details</a>
            <a className={`${styles.btn} ${styles.btnGhost}`} href="/?login=1">Staff login</a>
          </nav>
        </header>

        <main id="main">
          <section className={styles.hero} aria-labelledby="hero-title">
            <p className={styles.eyebrow}>Loans · Chit funds · Pawn</p>
            <h1 id="hero-title" className={styles.heroTitle}>{orgName}</h1>
            <p className={styles.heroText}>
              Loans, chit funds and pawn services, with every payment recorded. Apply online, then repay through your collection agent or by bank transfer.
            </p>
            <div className={styles.ctaRow}>
              <a className={`${styles.btn} ${styles.btnPrimary}`} href="/apply">Apply for a loan</a>
              <a className={`${styles.btn} ${styles.btnGhost}`} href="#pay">Bank details</a>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="services-title">
            <h2 id="services-title" className={styles.sectionTitle}>What we offer</h2>
            <p className={styles.sectionLead}>Three services, one place for your records.</p>
            <ul className={styles.cards}>
              {SERVICES.map(({ Icon, title, text }) => (
                <li key={title} className={styles.card}>
                  <div className={styles.cardIcon}><Icon size={26} aria-hidden="true" /></div>
                  <h3 className={styles.cardTitle}>{title}</h3>
                  <p className={styles.cardText}>{text}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.section} aria-labelledby="steps-title">
            <h2 id="steps-title" className={styles.sectionTitle}>How it works</h2>
            <p className={styles.sectionLead}>Three simple steps.</p>
            <ol className={`${styles.cards} ${styles.steps}`}>
              {STEPS.map((s, i) => (
                <li key={s.title} className={`${styles.card} ${styles.step}`}>
                  <span className={styles.stepNum} aria-hidden="true">{i + 1}</span>
                  <h3 className={styles.cardTitle}><span className={styles.srOnly}>Step {i + 1}: </span>{s.title}</h3>
                  <p className={styles.cardText}>{s.text}</p>
                </li>
              ))}
            </ol>
          </section>

          <section id="pay" className={styles.section} aria-labelledby="pay-title">
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
