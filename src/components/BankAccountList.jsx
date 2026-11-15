'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Check, Copy } from 'lucide-react';
import { BANK_ACCOUNTS } from '@/lib/bankAccounts.js';
import styles from './landing.module.css';

// Copies text, falling back to a hidden text box for browsers/phones that block the clipboard API.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const box = document.createElement('textarea');
      box.value = text;
      box.setAttribute('readonly', '');
      box.style.position = 'fixed';
      box.style.opacity = '0';
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(box);
      return ok;
    } catch {
      return false;
    }
  }
}

const detailsText = (a) => [
  a.bank,
  a.branch ? `Branch: ${a.branch}` : null,
  a.holder ? `Account holder: ${a.holder}` : null,
  `Account number: ${a.accountNumber}`
].filter(Boolean).join('\n');

// The bank accounts, each with a one-tap "Copy number" and a "Copy all details".
export default function BankAccountList() {
  const [copied, setCopied] = useState(''); // `${id}:number` or `${id}:all`
  const [announce, setAnnounce] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async (account, what) => {
    const ok = await copyText(what === 'number' ? account.accountNumber : detailsText(account));
    clearTimeout(timer.current);
    if (ok) {
      setCopied(`${account.id}:${what}`);
      setAnnounce(what === 'number' ? `Account number for ${account.label} copied.` : `Bank details for ${account.label} copied.`);
    } else {
      setCopied('');
      setAnnounce('Could not copy. Press and hold the number to select it.');
    }
    timer.current = setTimeout(() => { setCopied(''); setAnnounce(''); }, 2500);
  };

  return (
    <div>
      <ul className={styles.accounts}>
        {BANK_ACCOUNTS.map((a) => {
          const numberCopied = copied === `${a.id}:number`;
          const allCopied = copied === `${a.id}:all`;
          return (
            <li key={a.id} className={styles.account}>
              <h3 className={styles.accountLabel}>{a.label}</h3>
              <p className={styles.accountBank}>
                {a.bank}
                {a.branch ? <span className={styles.accountMeta}> · {a.branch} branch</span> : null}
              </p>
              {a.holder && <p className={styles.accountMeta}>Account holder: {a.holder}</p>}
              <p className={styles.accountNumber} aria-label={`Account number ${a.accountNumber.split('').join(' ')}`}>{a.accountNumber}</p>
              <div className={styles.accountActions}>
                <button type="button" className={`${styles.btn} ${numberCopied ? styles.btnDone : styles.btnPrimary}`} onClick={() => copy(a, 'number')}
                  aria-label={`Copy account number for ${a.label}`}>
                  {numberCopied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
                  {numberCopied ? 'Copied' : 'Copy number'}
                </button>
                <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => copy(a, 'all')}
                  aria-label={`Copy all bank details for ${a.label}`}>
                  {allCopied ? <Check size={18} aria-hidden="true" /> : null}
                  {allCopied ? 'Copied' : 'Copy all details'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div role="status" aria-live="polite" className={styles.srOnly}>{announce}</div>
    </div>
  );
}
