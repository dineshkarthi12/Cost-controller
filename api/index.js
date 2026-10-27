// Vercel serverless function: every /api/* request is rewritten here (see vercel.json).
// The Express app is bundled by `npm run vercel-build` into apps/api/dist.
export { default } from '../apps/api/dist/vercel.js';
