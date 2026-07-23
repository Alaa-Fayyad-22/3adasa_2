import Image from "next/image";

import styles from "./portfolio.module.css";

/**
 * Real pixel dimensions of public/logo-nav.png. Passed to next/image as the
 * intrinsic size so it computes the correct aspect ratio — the actual
 * on-screen box is controlled entirely by CSS (see .logoNav/.logoFooter in
 * portfolio.module.css), not by these numbers. Getting the ratio right here
 * matters even though the props aren't rendered 1:1: a mismatched aspect
 * (the previous width=120/height=50 was 2.4:1 against the file's real
 * 2.03:1) makes the browser stretch the raster to fill whatever box CSS
 * gives it, distorting the mark.
 */
const LOGO_WIDTH = 325;
const LOGO_HEIGHT = 160;

export type LogoVariant = "nav" | "footer";

interface LogoProps {
  variant: LogoVariant;
  className?: string;
}

/**
 * The Jad Daou mark, shared by SiteHeader and SiteFooter so the two can
 * never drift out of sync the way a separate <Image> + className in each
 * place would eventually invite (one gets resized/re-tuned, the other
 * doesn't). `variant` selects the CSS class that sets the actual rendered
 * height — see .logoNav/.logoFooter — everything else about the element is
 * identical between the two placements.
 */
export function Logo({ variant, className }: LogoProps) {
  const classes = [
    styles.logo,
    variant === "nav" ? styles.logoNav : styles.logoFooter,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Image
      src="/logo-nav.png"
      alt="Jad Photography"
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      // Only the nav copy is above the fold / a plausible LCP element.
      priority={variant === "nav"}
      className={classes}
    />
  );
}
