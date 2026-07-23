import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/*
 * TEMPORARY "coming soon" gate.
 *
 * Every incoming request is redirected to /coming-soon, so that is the only
 * page reachable on the site right now — the root URL included. The rest of the
 * built site (home, /portfolio, /booking, /blog, /about, /contact, …) is left
 * fully intact in the codebase; nothing is deleted or disabled. To switch the
 * real site back on, delete this file (or narrow the matcher) — no other change
 * is required.
 *
 * A 307 (temporary) redirect is used on purpose: browsers won't cache it, so
 * once this file is removed the old routes start resolving again immediately.
 */
// export function middleware(request: NextRequest) {
//   const url = request.nextUrl.clone();
//   url.pathname = '/coming-soon';
//   url.search = '';
//   return NextResponse.redirect(url);
// }

/*
 * Run on everything EXCEPT:
 *   - /coming-soon itself (would otherwise redirect to itself, a loop)
 *   - Next internals (/_next/*, which also covers optimized images)
 *   - any path with a file extension (favicon.ico, logo-nav.png, robots.txt, …)
 */
export const config = {
  matcher: ['/((?!coming-soon|_next|.*\\..*).*)'],
  // matcher: []
};
