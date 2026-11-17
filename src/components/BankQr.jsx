'use client';

import React, { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import QRCode from 'qrcode';
import { publicSiteUrl } from '@/lib/siteUrl.js';
import styles from './landing.module.css';

// A QR code that opens the public bank-details page (/pay) on the live domain (see lib/siteUrl.js),
// whichever address this page is opened from.
export default function BankQr() {
  const [image, setImage] = useState('');
  const target = `${publicSiteUrl({ envUrl: process.env.NEXT_PUBLIC_SITE_URL })}/pay`;
  const shown = target.replace(/^https?:\/\//, '');

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(target, { width: 640, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0f1426', light: '#ffffff' } })
      .then((data) => { if (!cancelled) setImage(data); })
      .catch(() => { if (!cancelled) setImage(''); });
    return () => { cancelled = true; };
  }, [target]);

  return (
    <div className={styles.qrCard}>
      <div className={styles.qrFrame}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} width={240} height={240} className={styles.qrImage} alt={`QR code. Scan it with your phone camera to open ${shown}.`} />
        ) : (
          <div className={styles.qrPlaceholder} aria-hidden="true" />
        )}
      </div>
      <p className={styles.qrCaption}>Scan to open our bank details</p>
      <p className={styles.qrUrl}>{shown}</p>
      {image && (
        <a className={`${styles.btn} ${styles.btnGhost}`} href={image} download="sabesh-bank-details-qr.png">
          <Download size={18} aria-hidden="true" /> Download QR
        </a>
      )}
    </div>
  );
}
