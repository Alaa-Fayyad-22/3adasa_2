"use client";

import { CONTACT } from "@/lib/portfolio/content";
import { useInView } from "@/lib/portfolio/hooks";
import { Logo } from "./Logo";
import styles from "./portfolio.module.css";

export function SiteFooter() {
  const [ref, revealed] = useInView();

  return (
    <footer id="contact" ref={ref} className={styles.footer} data-revealed={revealed}>
      <div className={styles.footerTop}>
        <div>
          <div className={styles.footerLogoWrap}>
            <Logo variant="footer" />
          </div>
          <p className={styles.footerBlurb}>
            Photography for portraits, landscapes, weddings, and editorial work.
          </p>
        </div>

        <div className={styles.footerColumn}>
          <span className={styles.footerHeading}>Contact</span>
          <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
          <a href={CONTACT.phoneHref}>{CONTACT.phone}</a>
        </div>

        <div className={styles.footerColumn}>
          <span className={styles.footerHeading}>Follow</span>
          <a href={CONTACT.instagram}>Instagram</a>
          <a href={CONTACT.journal}>Journal</a>
        </div>
      </div>

      <div className={styles.footerBase}>
        {/* Rendered from the visitor's clock, which may sit in a different
            year than the server's on New Year's Eve. */}
        <span suppressHydrationWarning>
          © {new Date().getFullYear()} Jad Daou. All rights reserved.
        </span>
      </div>
    </footer>
  );
}
