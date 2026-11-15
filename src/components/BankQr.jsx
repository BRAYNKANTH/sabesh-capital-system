'use client';

import React, { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import QRCode from 'qrcode';
import styles from './landing.module.css';

// A QR code that opens the public bank-details page (/pay). It is built in the browser from the
// address this site is served from, or from NEXT_PUBLIC_SITE_URL when that is set (so a QR made
// while testing on localhost can't end up printed with the wrong address).
export default function BankQr() {
  const [image, setImage] = useState('');
  const [url, setUrl] = useState('');

  useEffect(() => {
    const base = (process.env.NEXT_PUBLIC_SITE_URL || window.location.origin).replace(/\/+$/, '');
    const target = `${base}/pay`;
    setUrl(target);
    let cancelled = false;
    QRCode.toDataURL(target, { width: 640, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0f1b31', light: '#ffffff' } })
      .then((data) => { if (!cancelled) setImage(data); })
      .catch(() => { if (!cancelled) setImage(''); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className={styles.qrCard}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} width={240} height={240} className={styles.qrImage} alt="QR code. Scan it with your phone camera to open the bank details page." />
      ) : (
        <div className={styles.qrPlaceholder} aria-hidden="true" />
      )}
      <p className={styles.qrCaption}>Scan to open our bank details</p>
      {url && <p className={styles.qrUrl}>{url}</p>}
      {image && (
        <a className={`${styles.btn} ${styles.btnGhost}`} href={image} download="bank-details-qr.png">
          <Download size={18} aria-hidden="true" /> Download QR
        </a>
      )}
    </div>
  );
}
