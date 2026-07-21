"use client";

import { useEffect, useRef } from "react";

import styles from "./portfolio.module.css";

export type NavTarget = "portfolio" | "about" | "booking" | "contact";

const NAV_ITEMS: { target: NavTarget; label: string }[] = [
  { target: "portfolio", label: "Portfolio" },
  { target: "about", label: "About" },
  { target: "booking", label: "Booking" },
  { target: "contact", label: "Contact" },
];

interface SiteHeaderProps {
  menuOpen: boolean;
  onToggleMenu: () => void;
  onNavigate: (target: NavTarget) => void;
}

export function SiteHeader({
  menuOpen,
  onToggleMenu,
  onNavigate,
}: SiteHeaderProps) {
  const firstItemRef = useRef<HTMLButtonElement>(null);

  // Move focus into the overlay when it opens, and close it on Escape —
  // the menu covers the whole viewport, so it has to be escapable.
  useEffect(() => {
    if (!menuOpen) return;

    firstItemRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onToggleMenu();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen, onToggleMenu]);

  return (
    <>
      <header className={styles.header}>
        <a className={styles.wordmark} href="#top">
          JAD&nbsp;DAOU
        </a>
        <button
          type="button"
          onClick={onToggleMenu}
          className={styles.menuToggle}
          aria-expanded={menuOpen}
          aria-controls="site-menu"
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
      </header>

      {menuOpen && (
        <nav id="site-menu" className={styles.menu} aria-label="Main">
          {NAV_ITEMS.map((item, index) => (
            <button
              key={item.target}
              ref={index === 0 ? firstItemRef : undefined}
              type="button"
              onClick={() => onNavigate(item.target)}
              className={styles.menuItem}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onToggleMenu}
            className={styles.menuClose}
          >
            Close
          </button>
        </nav>
      )}
    </>
  );
}
