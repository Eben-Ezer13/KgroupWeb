/*
 * Vercel adapter for the API shared with Netlify.
 *
 * The application logic uses standard Fetch Request/Response objects. Vercel's
 * Node function interface uses (req, res), so this small adapter preserves the
 * same API routes without duplicating authentication or database code.
 */
import handler from "../netlify/functions/api.mjs";

export default async function vercelApi(req, res) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const origin = `${protocol}://${req.headers.host}`;
  const init = {
    method: req.method,
    headers: req.headers,
  };

  // Node's Fetch implementation requires duplex when a stream is used as the
  // request body. GET and HEAD must not contain one.
  if (!/^(GET|HEAD)$/i.test(req.method || "GET")) {
    init.body = req;
    init.duplex = "half";
  }

  const response = await handler(new Request(new URL(req.url, origin), init));
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}
