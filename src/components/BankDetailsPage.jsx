'use client';

import React from 'react';
import BankAccountList from './BankAccountList.jsx';
import BankQr from './BankQr.jsx';
import useOrgName from './useOrgName.js';
import styles from './landing.module.css';

// The page the QR code opens: just the bank accounts, laid out for a phone, with copy buttons.
export default function BankDetailsPage() {
  const orgName = useOrgName();

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
            <a className={styles.navLink} href="/welcome">Home</a>
            <a className={`${styles.btn} ${styles.btnGhost}`} href="/apply">Apply for a loan</a>
          </nav>
        </header>

        <main id="main">
          <section className={styles.hero} aria-labelledby="pay-page-title">
            <h1 id="pay-page-title" className={styles.heroTitle} style={{ fontSize: 'clamp(34px, 8vw, 56px)' }}>Bank details</h1>
            <p className={styles.heroText}>
              Tap <strong>Copy number</strong> next to an account, then paste it into your banking app. Keep the transfer slip and tell your agent after you pay.
            </p>
          </section>

          <section className={styles.section} style={{ paddingTop: 0 }} aria-label="Bank accounts and QR code">
            <div className={styles.payGridList}>
              <BankAccountList />
              <BankQr />
            </div>
          </section>
        </main>

        <footer className={styles.footer}>
          <div>© {new Date().getFullYear()} {orgName}</div>
        </footer>
      </div>
    </div>
  );
}
