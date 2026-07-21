"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
} from "react";

import {
  buildCalendar,
  formatDate,
  isUnavailable,
  WEEKDAY_LABELS,
  type CalendarMonth,
} from "@/lib/portfolio/availability";
import { DEFAULT_PACKAGE_ID, PACKAGES, type Package } from "@/lib/portfolio/content";
import {
  mergeRefs,
  useFreezeOnFocus,
  useInView,
  useSectionProgress,
  useTilt,
} from "@/lib/portfolio/hooks";
import { BOOKING_SECTION_ID } from "@/lib/portfolio/scroll";
import styles from "./portfolio.module.css";

interface BookingProps {
  /** Lets the booking UI expand the custom cursor while hovering a card. */
  onCursorLabel: (expanded: boolean) => void;
  /**
   * Whether this section participates in the page's scroll-driven motion.
   * False for reduced-motion visitors, who keep the one-shot reveal only.
   */
  scrollMotion: boolean;
}

interface FormState {
  name: string;
  email: string;
  phone: string;
  location: string;
  message: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  email: "",
  phone: "",
  location: "",
  message: "",
};

interface SubmittedInfo {
  name: string;
  packageName: string;
  date: string;
}

/**
 * Per-card floating pose: a staggered base Z (like the gallery wall's
 * staggered plane depths) plus an independent drift vector per card, so the
 * three panels parallax against each other as booking progress moves — not
 * one shared transform on a parent.
 *
 * All Z values (base ± full drift range) stay POSITIVE — toward the viewer.
 * In a preserve-3d context, an element pushed to negative Z sits behind its
 * ancestors' z=0 hit-planes and becomes unreachable by mouse clicks even
 * though it paints; keeping depth in front of the page plane avoids that
 * class of bug entirely.
 */
const CARD_DEPTHS = [
  { z: "36px", driftX: "-20px", driftY: "-8px", driftZ: "-26px", rotY: "-2.4deg" },
  { z: "84px", driftX: "5px", driftY: "-16px", driftZ: "10px", rotY: "1.4deg" },
  { z: "22px", driftX: "22px", driftY: "-5px", driftZ: "-34px", rotY: "2.8deg" },
];

export function Booking({ onCursorLabel, scrollMotion }: BookingProps) {
  const [inViewRef, revealed] = useInView();
  const progressRef = useSectionProgress(scrollMotion);
  const sectionRef = useMemo(
    () => mergeRefs(inViewRef, progressRef),
    [inViewRef, progressRef],
  );
  // One callback serves both far panels — each attachment gets its own closure.
  const freezeRef = useFreezeOnFocus();

  const [selectedPackage, setSelectedPackage] = useState(DEFAULT_PACKAGE_ID);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<SubmittedInfo | null>(null);

  // The calendar depends on today's date, which can differ between the server
  // and the visitor's timezone — build it after mount to keep hydration clean.
  const [calendar, setCalendar] = useState<CalendarMonth | null>(null);
  useEffect(() => setCalendar(buildCalendar()), []);

  const updateField =
    (field: keyof FormState) =>
    (
      event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ): void => {
      const { value } = event.target;
      setForm((current) => ({ ...current, [field]: value }));
    };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.name.trim() || !form.email.trim()) {
      setError("Please share your name and email.");
      return;
    }
    if (!selectedDate) {
      setError("Please select a date from the calendar.");
      return;
    }

    const chosen = PACKAGES.find((p) => p.id === selectedPackage);
    setError("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          packageId: selectedPackage,
          date: selectedDate,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Something went wrong.");
      }

      setSubmitted({
        name: form.name,
        packageName: chosen?.name ?? "",
        date: selectedDate,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Your inquiry couldn't be sent. Please try again or email directly.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSubmitted(null);
    setSelectedDate(null);
    setForm(EMPTY_FORM);
    setError("");
  };

  return (
    <section
      id={BOOKING_SECTION_ID}
      ref={sectionRef}
      className={styles.booking}
      data-revealed={revealed}
    >
      <div className={styles.bookingIntro}>
        <p className={styles.eyebrow}>Booking</p>
        <h2 className={styles.sectionTitle}>Reserve&nbsp;a&nbsp;Date</h2>
        <p className={styles.mutedCopy}>
          Sessions are booked several weeks out. Choose a package, check
          availability, and send an inquiry — I&rsquo;ll follow up personally
          within 24&ndash;48 hours.
        </p>
      </div>

      <div className={styles.packages}>
        {PACKAGES.map((pkg, index) => (
          <PackageCard
            key={pkg.id}
            pkg={pkg}
            selected={selectedPackage === pkg.id}
            onSelect={() => setSelectedPackage(pkg.id)}
            revealed={revealed}
            index={index}
            onCursorLabel={onCursorLabel}
          />
        ))}
      </div>

      <p className={styles.retainerNote}>
        A 30% non-refundable retainer secures your date; the remaining balance
        is due on the day of delivery.
      </p>

      <div className={styles.bookingGrid}>
        <div className={styles.farPanel} ref={freezeRef}>
          <p className={styles.calendarLabel}>
            Availability — {calendar?.label ?? " "}
          </p>

          <div className={styles.weekdays} aria-hidden="true">
            {WEEKDAY_LABELS.map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>

          <div className={styles.calendarStage} data-revealed={revealed}>
          <div className={styles.calendar}>
            {calendar?.days.map((day, index) => {
              if (day === null) {
                return <span key={`pad-${index}`} className={styles.dayPad} />;
              }

              const unavailable = isUnavailable(
                calendar.year,
                calendar.month,
                day,
              );
              const label = formatDate(calendar.year, calendar.month, day);

              return (
                <CalendarDay
                  key={day}
                  day={day}
                  label={label}
                  unavailable={unavailable}
                  selected={selectedDate === label}
                  onSelect={() => setSelectedDate(label)}
                />
              );
            })}
          </div>
          </div>

          <p className={styles.calendarNote}>
            Dates shown reflect general availability — exact times confirmed
            after inquiry.
          </p>
        </div>

        <div className={styles.farPanel} ref={freezeRef}>
          {submitted ? (
            <div className={styles.success} role="status">
              <span className={styles.successMark} aria-hidden="true">
                ✓
              </span>
              <h3 className={styles.successHeading}>Inquiry Received</h3>
              <p className={styles.bodyCopy}>
                Thank you, {submitted.name}. Your inquiry for the{" "}
                {submitted.packageName} on {submitted.date}{" "}
                has been received. Expect a personal reply within 24&ndash;48
                hours with availability confirmation and next steps.
              </p>
              <button
                type="button"
                onClick={resetForm}
                className={styles.ghostButton}
              >
                Submit Another Inquiry
              </button>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className={styles.form}
              data-revealed={revealed}
              noValidate
            >
              <Field
                label="Name"
                id="booking-name"
                value={form.name}
                onChange={updateField("name")}
                placeholder="Your name"
                required
              />
              <Field
                label="Email"
                id="booking-email"
                type="email"
                value={form.email}
                onChange={updateField("email")}
                placeholder="you@email.com"
                required
              />
              <Field
                label="Phone"
                id="booking-phone"
                type="tel"
                value={form.phone}
                onChange={updateField("phone")}
                placeholder="Optional"
              />
              <Field
                label="Location"
                id="booking-location"
                value={form.location}
                onChange={updateField("location")}
                placeholder="City or venue"
              />

              <div className={styles.fieldWide}>
                <span className={styles.fieldLabel}>Preferred Date</span>
                <p className={styles.dateReadout} data-empty={!selectedDate}>
                  {selectedDate ?? "Select a date above"}
                </p>
              </div>

              <fieldset className={styles.fieldWide}>
                <legend className={styles.fieldLabel}>Package</legend>
                <div className={styles.pillsStage}>
                  <div className={styles.pills}>
                    {PACKAGES.map((pkg) => (
                      <PackagePill
                        key={pkg.id}
                        label={pkg.name}
                        selected={selectedPackage === pkg.id}
                        onSelect={() => setSelectedPackage(pkg.id)}
                      />
                    ))}
                  </div>
                </div>
              </fieldset>

              <div className={styles.fieldWide}>
                <label className={styles.fieldLabel} htmlFor="booking-message">
                  Message
                </label>
                <textarea
                  id="booking-message"
                  value={form.message}
                  onChange={updateField("message")}
                  placeholder="Tell me about the day, the light you love, anything I should know."
                  rows={4}
                  className={styles.textarea}
                />
              </div>

              {error && (
                <p className={styles.formError} role="alert">
                  {error}
                </p>
              )}

              <div className={styles.fieldWide}>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={submitting}
                >
                  {submitting ? "Sending…" : "Send Inquiry"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function PackageCard({
  pkg,
  selected,
  onSelect,
  revealed,
  index,
  onCursorLabel,
}: {
  pkg: Package;
  selected: boolean;
  onSelect: () => void;
  revealed: boolean;
  index: number;
  onCursorLabel: (expanded: boolean) => void;
}) {
  const tiltRef = useTilt({
    maxTilt: 9,
    lift: 8,
    scale: 1.03,
    onHover: () => onCursorLabel(true),
    onLeave: () => onCursorLabel(false),
  });

  // Three nested layers, each owning exactly one transform, so they compose
  // instead of overwriting each other: wrapper = one-shot reveal (transitioned),
  // depth = continuous scroll motion (never transitioned, it tracks scroll),
  // card = pointer tilt (written inline by useTilt). The tilt ref sits on the
  // WRAPPER — the stable hitbox — while the transform lands on the card via
  // data-tilt-target, so the hover boundary never moves with the tilt.
  const depth = CARD_DEPTHS[index % CARD_DEPTHS.length];

  return (
    <div
      ref={tiltRef}
      className={styles.packageWrapper}
      data-revealed={revealed}
      style={
        {
          "--reveal-delay": `${index * 100}ms`,
          "--pz": depth.z,
          "--pdx": depth.driftX,
          "--pdy": depth.driftY,
          "--pdz": depth.driftZ,
          "--pry": depth.rotY,
        } as CSSProperties
      }
    >
      <div className={styles.packageDepth}>
        <div
          data-tilt-target
          className={styles.packageCard}
          data-selected={selected}
        >
          <span className={styles.tiltGlow} aria-hidden="true" />

          {pkg.badge && (
            <span className={styles.packageBadge}>Most&nbsp;Booked</span>
          )}

          <div>
            <h3 className={styles.packageName}>{pkg.name}</h3>
            <p className={styles.packageDuration}>{pkg.duration}</p>
          </div>

          <p className={styles.packagePrice}>{pkg.price}</p>

          <ul className={styles.packageIncludes}>
            {pkg.includes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <button
            type="button"
            onClick={onSelect}
            className={styles.packageSelect}
            data-selected={selected}
            aria-pressed={selected}
          >
            {selected ? "Selected" : "Select Package"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PackagePill({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const tiltRef = useTilt({ maxTilt: 6, lift: 4, scale: 1.06 });

  return (
    <button
      ref={tiltRef}
      type="button"
      onClick={onSelect}
      className={styles.pill}
      data-selected={selected}
      aria-pressed={selected}
    >
      {label}
    </button>
  );
}

function CalendarDay({
  day,
  label,
  unavailable,
  selected,
  onSelect,
}: {
  day: number;
  label: string;
  unavailable: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    // Pop-and-settle: start scaled up with no transition, then release.
    const element = ref.current;
    if (element) {
      element.style.transition = "none";
      element.style.transform = "translateZ(0) scale(1.22)";
      element.style.boxShadow = "0 14px 28px rgba(201,163,91,0.4)";
      requestAnimationFrame(() => {
        element.style.transition =
          "transform 0.4s var(--ease-overshoot), box-shadow 0.4s ease";
        element.style.transform = "translateZ(0) scale(1)";
        element.style.boxShadow = "none";
      });
    }
    onSelect();
  };

  return (
    <button
      ref={ref}
      type="button"
      disabled={unavailable}
      onClick={handleClick}
      className={styles.day}
      data-selected={selected}
      aria-label={unavailable ? `${label} — unavailable` : label}
      aria-pressed={selected}
    >
      {day}
    </button>
  );
}

function Field({
  label,
  id,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        className={styles.input}
      />
    </div>
  );
}
