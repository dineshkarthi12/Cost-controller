/** Vercel serverless entry: the Express app as a request handler (no listen, no in-process scheduler). */
import { createApp } from './app.js';

export default createApp();
