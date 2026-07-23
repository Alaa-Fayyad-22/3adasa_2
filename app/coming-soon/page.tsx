import type { Metadata } from 'next';
import Image from 'next/image';

/*
 * The only page the site currently serves — see middleware.ts, which redirects
 * every other route here. Deliberately bare: no nav, no footer, no links off
 * the page (Nav/Footer detect this path and render nothing). It sits directly
 * on the body's cream canvas and uses the same palette/type system as the rest
 * of the (dormant) site, so switching the real site back on is just a matter of
 * removing the middleware.
 */

export const metadata: Metadata = {
  title: 'Coming Soon',
  description: 'Jad Photography — coming soon.',
};

export default function ComingSoonPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cream px-6 text-center">
      {/*
       * Same brand mark and treatment as the nav (transparent PNG +
       * drop-shadow-logo); just scaled up a little for a centred hero. The mark
       * stands alone, so there is no separate "JAD" wordmark.
       */}
      <Image
        src="/logo-nav.png"
        alt="Jad Photography"
        width={325}
        height={160}
        priority
        className="h-16 w-auto drop-shadow-logo"
      />

      <p className="mt-10 font-display text-2xl font-bold tracking-tight text-ink">
        Coming soon
      </p>

      {/* Animated "..." — three staggered steel dots. Decorative only. */}
      <div className="mt-5 flex items-center gap-2" aria-hidden="true">
        <span
          className="h-2.5 w-2.5 rounded-full bg-steel animate-dot-pulse"
          style={{ animationDelay: '0ms' }}
        />
        <span
          className="h-2.5 w-2.5 rounded-full bg-steel animate-dot-pulse"
          style={{ animationDelay: '180ms' }}
        />
        <span
          className="h-2.5 w-2.5 rounded-full bg-steel animate-dot-pulse"
          style={{ animationDelay: '360ms' }}
        />
      </div>
    </div>
  );
}
