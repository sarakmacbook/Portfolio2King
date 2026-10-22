/** Rejects cross-site browser requests. Used by the alert subscription endpoints. */
export function rejectCrossOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    return Response.json(
      { error: "This endpoint only accepts requests from the app." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return Response.json(
      { error: "This endpoint only accepts requests from the app." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const allowedHosts = [
    request.headers.get("host"),
    request.headers.get("x-forwarded-host"),
    new URL(request.url).host,
  ].filter(Boolean);
  if (!allowedHosts.includes(originHost) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json(
      { error: "This endpoint only accepts requests from the app." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  return null;
}
