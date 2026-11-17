'use client';

import React from 'react';
import { Copy, ClipboardPaste, Receipt, ShieldCheck } from 'lucide-react';
import BankAccountList from './BankAccountList.jsx';
import BankQr from './BankQr.jsx';
import useOrgName from './useOrgName.js';
import styles from './landing.module.css';

const HOW = [
  { Icon: Copy, title: 'Copy', text: 'Tap Copy number on the account you want to pay.' },
  { Icon: ClipboardPaste, title: 'Paste', text: 'Paste it into your banking app and send the money.' },
  { Icon: Receipt, title: 'Tell us', text: 'Keep the transfer slip and show it to your agent.' }
];

// The page the QR code opens: the bank accounts, laid out for a phone, with copy buttons.
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
          <section className={`${styles.heroPanel} ${styles.payHero}`} aria-labelledby="pay-page-title">
            <span className={styles.heroGlow} aria-hidden="true" />
            <span className={styles.heroArc} aria-hidden="true" />
            <div className={styles.heroCopy}>
              <p className={styles.heroEyebrow}>Pay by bank transfer</p>
              <h1 id="pay-page-title" className={styles.heroH1}>
                Our <span className={styles.heroAccent}>bank details</span>
              </h1>
              <p className={styles.heroLead}>
                Copy an account number with one tap, paste it into your banking app, and send your payment. Then show the transfer slip to your agent so it can be recorded.
              </p>
              <ol className={styles.howList}>
                {HOW.map(({ Icon, title, text }, i) => (
                  <li key={title} className={styles.howItem}>
                    <span className={styles.howIcon}><Icon size={18} aria-hidden="true" /></span>
                    <span><strong>{i + 1}. {title}.</strong> {text}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className={styles.heroCard}>
              <BankQr />
            </div>
          </section>

          <section className={styles.section} aria-labelledby="accounts-title">
            <h2 id="accounts-title" className={styles.sectionTitle}>Choose an account</h2>
            <p className={styles.sectionLead}>Any of these accounts works. Pick the bank you use.</p>
            <BankAccountList columns={2} />
            <p className={styles.safeNote}><ShieldCheck size={18} aria-hidden="true" /> Only pay into the accounts on this page. If anyone gives you a different number, call us first.</p>
          </section>
        </main>

        <footer className={styles.footer}>
          <div className={styles.footerLinks}>
            <a className={styles.navLink} href="/welcome">Home</a>
            <a className={styles.navLink} href="/apply">Apply for a loan</a>
            <a className={styles.navLink} href="/welcome#contact">Contact</a>
          </div>
          <div>© {new Date().getFullYear()} {orgName}</div>
        </footer>
      </div>
    </div>
  );
}
