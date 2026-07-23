import type { Metadata } from 'next';
import Image from 'next/image';

import styles from './page.module.css';

/*
 * The only page the site currently serves — see proxy.ts, which redirects
 * every other route here. Deliberately bare: no nav, no footer, no links off
 * the page (Nav/Footer detect this path and render nothing). It sits directly
 * on its own cream canvas and uses the same type system as the rest of the
 * (dormant) site, so switching the real site back on is just a matter of
 * removing the proxy.
 *
 * Signature move: a camera aperture (iris) breathing slowly open behind the
 * logo, but never quite reaching fully open before it closes again — the
 * visual argument for the page, not decoration on top of it. Everything else
 * stays quiet on purpose.
 *
 * Styled with a plain CSS Module (page.module.css), not Tailwind utility
 * classes — this project has no Tailwind installed, so a previous version of
 * this file (all its centering, sizing, and cream/ink colours expressed as
 * Tailwind classes) rendered as unstyled content pinned to the top-left on a
 * background inherited from the main site's unrelated DARK theme.
 */

export const metadata: Metadata = {
  title: 'Coming Soon',
  description: 'Jad Photography — coming soon.',
};

const BLADE_COUNT = 7;

export default function ComingSoonPage() {
  const blades = Array.from({ length: BLADE_COUNT });

  return (
    <div className={styles.page}>
      {/* Aperture — a ring of blades that slowly open, hold short of fully
          open, then close again. Purely decorative; hidden from screen
          readers. Frozen at a half-open frame when motion is reduced. */}
      <div className={styles.aperture} aria-hidden="true">
        {blades.map((_, i) => (
          <span
            key={i}
            className={styles.bladeBlade}
            style={{
              transform: `rotate(${(360 / BLADE_COUNT) * i}deg)`,
              animationDelay: `${i * 0.05}s`,
            }}
          />
        ))}
      </div>

      <Image
        src="/logo-nav.png"
        alt="Jad Photography"
        width={325}
        height={160}
        priority
        className={styles.logo}
      />

      <p className={styles.title}>Coming soon</p>

      <p className={styles.subtitle}>
        Every frame is still developing. The full gallery opens soon.
      </p>

      {/* Three staggered steel dots — kept from the original page. */}
      <div className={styles.dots} aria-hidden="true">
        <span className={styles.dot} style={{ animationDelay: '0ms' }} />
        <span className={styles.dot} style={{ animationDelay: '180ms' }} />
        <span className={styles.dot} style={{ animationDelay: '360ms' }} />
      </div>
    </div>
  );
}
