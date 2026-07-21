import { NextResponse } from "next/server";

import { PACKAGES } from "@/lib/portfolio/content";

interface InquiryPayload {
  name: string;
  email: string;
  phone: string;
  location: string;
  message: string;
  packageId: string;
  date: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MESSAGE_LENGTH = 4000;

function validate(body: unknown): InquiryPayload | string {
  if (typeof body !== "object" || body === null) return "Malformed request.";

  const raw = body as Record<string, unknown>;
  const text = (key: string) =>
    typeof raw[key] === "string" ? (raw[key] as string).trim() : "";

  const name = text("name");
  const email = text("email");
  const date = text("date");
  const packageId = text("packageId");

  if (!name) return "Please share your name.";
  if (!EMAIL_PATTERN.test(email)) return "Please provide a valid email address.";
  if (!date) return "Please select a date.";
  if (!PACKAGES.some((p) => p.id === packageId)) return "Unknown package.";

  const message = text("message");
  if (message.length > MAX_MESSAGE_LENGTH) return "That message is too long.";

  return {
    name,
    email,
    date,
    packageId,
    message,
    phone: text("phone"),
    location: text("location"),
  };
}

/**
 * Booking inquiries.
 *
 * Validation is real; delivery is not yet — the inquiry is logged and
 * acknowledged. Wire the marked spot below to wherever these should actually
 * land (transactional email, CRM, or a database) before going live, otherwise
 * submissions are accepted and dropped.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const result = validate(body);
  if (typeof result === "string") {
    return NextResponse.json({ error: result }, { status: 400 });
  }

  // TODO: deliver the inquiry — e.g. Resend/Postmark for email, or persist it.
  console.info("[inquiry]", {
    name: result.name,
    email: result.email,
    date: result.date,
    packageId: result.packageId,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
