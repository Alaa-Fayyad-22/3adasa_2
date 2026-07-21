"use client";

import { CATEGORIES, type CategoryId } from "@/lib/portfolio/content";
import styles from "./portfolio.module.css";

interface CategoryFilterProps {
  active: CategoryId;
  onSelect: (id: CategoryId) => void;
  className?: string;
}

export function CategoryFilter({
  active,
  onSelect,
  className,
}: CategoryFilterProps) {
  return (
    <div
      className={[styles.filters, className].filter(Boolean).join(" ")}
      role="tablist"
      aria-label="Portfolio categories"
    >
      {CATEGORIES.map((category) => (
        <button
          key={category.id}
          type="button"
          role="tab"
          aria-selected={active === category.id}
          onClick={() => onSelect(category.id)}
          className={styles.filter}
          data-active={active === category.id}
        >
          {category.label}
        </button>
      ))}
    </div>
  );
}
