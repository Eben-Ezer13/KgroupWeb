if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running this health check.");
}
const { default: handler } = await import('./netlify/functions/api.mjs');
const res = await handler(new Request('http://localhost/api/health'));
console.log(res.status);
console.log(await res.text());
