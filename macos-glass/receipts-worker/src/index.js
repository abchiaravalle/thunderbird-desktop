// Read-receipt service for the Superhuman-style Thunderbird fork.
//
//   GET /p/<32 hex>.gif   1x1 transparent GIF; logs one open (time, rough place, device kind)
//   GET /api/opens?ids=a,b,c   Bearer TOKEN -> {"<id>": [{t, kind, city, country}], ...}
//   anything else           empty 404
//
// Stores no message content, addresses or subjects: only the random id the
// sending app put in the image URL.

const GIF = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  c => c.charCodeAt(0)
);
const ID = /^[a-f0-9]{32}$/;
const MAX_OPENS_PER_ID = 500;
const KEEP_DAYS = 180;

const empty404 = () => new Response(null, { status: 404 });

function kindOf(request) {
  const ua = request.headers.get("user-agent") || "";
  const org = (request.cf && request.cf.asOrganization) || "";
  if (/GoogleImageProxy/i.test(ua)) return "gmail";
  if (/YahooMailProxy/i.test(ua)) return "yahoo";
  if (/Apple/i.test(org)) return "apple-privacy";
  if (/iPhone|iPad|Android|Mobile/i.test(ua)) return "phone";
  return "desktop";
}

function sameToken(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function logOpen(env, id, request) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM opens WHERE rid = ?").bind(id).first();
  if (row && row.n >= MAX_OPENS_PER_ID) return;
  const cf = request.cf || {};
  await env.DB.prepare(
    "INSERT INTO opens (rid, t, kind, city, region, country) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, Date.now(), kindOf(request), cf.city || null, cf.region || null, cf.country || null)
    .run();
}

async function opens(env, ids) {
  const out = Object.fromEntries(ids.map(id => [id, []]));
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const q = `SELECT rid, t, kind, city, country FROM opens WHERE rid IN (${chunk.map(() => "?").join(",")}) ORDER BY t`;
    const { results } = await env.DB.prepare(q).bind(...chunk).all();
    for (const r of results) out[r.rid].push({ t: r.t, kind: r.kind, city: r.city, country: r.country });
  }
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" || request.method === "HEAD") {
      const m = url.pathname.match(/^\/p\/([a-f0-9]{32})\.gif$/);
      if (m) {
        if (request.method === "GET") ctx.waitUntil(logOpen(env, m[1], request).catch(() => {}));
        return new Response(request.method === "GET" ? GIF : null, {
          headers: {
            "content-type": "image/gif",
            "cache-control": "no-store, no-cache, must-revalidate, private, max-age=0",
            pragma: "no-cache",
            expires: "0",
          },
        });
      }
      if (url.pathname === "/api/opens" && request.method === "GET") {
        const auth = request.headers.get("authorization") || "";
        if (!sameToken(auth.replace(/^Bearer\s+/i, ""), env.TOKEN)) return empty404();
        const ids = (url.searchParams.get("ids") || "").split(",").filter(id => ID.test(id)).slice(0, 300);
        return new Response(JSON.stringify(await opens(env, ids)), {
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      }
    }
    return empty404();
  },

  async scheduled(event, env) {
    await env.DB.prepare("DELETE FROM opens WHERE t < ?").bind(Date.now() - KEEP_DAYS * 864e5).run();
  },
};
