// Cloudflare Pages Function: same-origin proxy to the API Worker.
//
// The PWA calls /api/* on its own domain and this forwards the request to the
// Worker. Some DNS filters block whole shared hostnames (*.pages.dev, and
// possibly *.workers.dev), so keeping API traffic on the app's own domain means
// the phone never has to resolve workers.dev. The upstream fetch runs on
// Cloudflare's edge, which is not subject to the client's DNS filter.
//
// Auth is unchanged: the X-App-Key header is passed through and checked by the
// Worker. Set WORKER_ORIGIN in the Pages project to override the default.

const DEFAULT_WORKER_ORIGIN = "https://workout-pwa-api.garcia-javier-alejandro.workers.dev";

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const origin = (env.WORKER_ORIGIN || DEFAULT_WORKER_ORIGIN).replace(/\/+$/, "");
  const target = origin + url.pathname.replace(/^\/api/, "") + url.search;

  const headers = new Headers();
  for (const name of ["Content-Type", "X-App-Key"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  try {
    const res = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
    });
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "upstream_unreachable", detail: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}
