"use client";

import { useEffect, useRef, type CSSProperties } from "react";

import {
  getCategory,
  SPAN_PATTERN,
  tileSlotId,
  type CategoryId,
} from "@/lib/portfolio/content";
import { ABOUT_SLOT_ID, HERO_SLOT_ID } from "@/lib/portfolio/images";
import { useInView } from "@/lib/portfolio/hooks";
import { CategoryFilter } from "./CategoryFilter";
import { ImageSlot } from "./ImageSlot";
import styles from "./portfolio.module.css";

interface StaticShowcaseProps {
  activeCategory: CategoryId;
  onCategoryChange: (id: CategoryId) => void;
  onOpenTile: (index: number) => void;
  parallaxIntensity: number;
  heroRevealed: boolean;
}

/**
 * The flat counterpart to the 3D journey, used when WebGL is unavailable or
 * the visitor has asked for reduced motion. Same content, laid out as a
 * conventional hero → grid → about page.
 */
export function StaticShowcase({
  activeCategory,
  onCategoryChange,
  onOpenTile,
  parallaxIntensity,
  heroRevealed,
}: StaticShowcaseProps) {
  const heroImageRef = useRef<HTMLDivElement>(null);
  const [aboutRef, aboutInView] = useInView();

  // Hero parallax, driven straight from the scroll position on an animation
  // frame so it doesn't re-render the page on every scroll event.
  useEffect(() => {
    if (parallaxIntensity <= 0) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const element = heroImageRef.current;
      if (!element) return;
      const shift = Math.min(window.scrollY * parallaxIntensity, 220);
      element.style.transform = `translateY(${shift}px) scale(1.08)`;
    };

    const handleScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [parallaxIntensity]);

  const category = getCategory(activeCategory);

  return (
    <>
      <section id="hero" className={styles.staticHero}>
        <div ref={heroImageRef} className={styles.staticHeroImage}>
          <ImageSlot
            slotId={HERO_SLOT_ID}
            alt="Full-bleed cinematic coastal light"
            eager
            className={styles.fill}
          />
        </div>
        <div className={styles.staticHeroScrim} aria-hidden="true" />
        <div className={styles.staticHeroCopy} data-revealed={heroRevealed}>
          <p className={styles.eyebrow}>
            Photography — Portraits · Landscape · Weddings · Fashion
          </p>
          <h1 className={styles.heroTitle}>Jad&nbsp;Daou</h1>
          <p className={styles.heroTagline}>
            Coastal light. Quiet portraits. Editorial stillness.
          </p>
        </div>
      </section>

      <section id="portfolio" className={styles.staticPortfolio}>
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.eyebrow}>Selected Work</p>
            <h2 className={styles.sectionTitle}>The&nbsp;Portfolio</h2>
          </div>
          <CategoryFilter active={activeCategory} onSelect={onCategoryChange} />
        </div>

        <div className={styles.grid}>
          {category.captions.map((caption, index) => (
            <GridTile
              key={tileSlotId(activeCategory, index)}
              slotId={tileSlotId(activeCategory, index)}
              caption={caption}
              alt={`${category.label} — ${caption}`}
              colSpan={SPAN_PATTERN[index][0]}
              rowSpan={SPAN_PATTERN[index][1]}
              delay={index * 70}
              onOpen={() => onOpenTile(index)}
            />
          ))}
        </div>
      </section>

      <section
        id="about"
        ref={aboutRef}
        className={styles.about}
        data-revealed={aboutInView}
      >
        <div className={styles.aboutPortrait}>
          <ImageSlot
            slotId={ABOUT_SLOT_ID}
            alt="Portrait — Jad on location"
            className={styles.aboutPortraitImage}
          />
          <span className={styles.aboutStamp}>Big&nbsp;Sur,&nbsp;2025</span>
        </div>
        <div className={styles.aboutCopy}>
          <p className={styles.eyebrow}>About</p>
          <h2 className={styles.aboutHeading}>
            A practice built on waiting for the frame that doesn&rsquo;t need
            explaining.
          </h2>
          <p className={styles.bodyCopy}>
            Jad Daou works at the edge of light — where coastline meets fog, and
            portraiture becomes landscape. Based between the Mediterranean and
            the Pacific, his practice moves fluidly across weddings, editorial
            fashion, and quiet character studies.
          </p>
          <p className={styles.bodyCopy}>
            Prints and limited-edition works are available by request. For
            sessions and collaborations, see below.
          </p>
        </div>
      </section>
    </>
  );
}

interface GridTileProps {
  slotId: string;
  caption: string;
  alt: string;
  colSpan: number;
  rowSpan: number;
  delay: number;
  onOpen: () => void;
}

function GridTile({
  slotId,
  caption,
  alt,
  colSpan,
  rowSpan,
  delay,
  onOpen,
}: GridTileProps) {
  const [ref, inView] = useInView();

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      className={styles.tile}
      data-revealed={inView}
      style={
        {
          "--col-span": colSpan,
          "--row-span": rowSpan,
          "--reveal-delay": `${delay}ms`,
        } as CSSProperties
      }
    >
      <span className={styles.tileZoom}>
        <ImageSlot slotId={slotId} alt={alt} className={styles.fill} />
      </span>
      <span className={styles.tileCaption}>{caption}</span>
    </button>
  );
}
