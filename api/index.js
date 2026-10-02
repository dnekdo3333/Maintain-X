/**
 * Vercel serverless entry: the whole Express API as one function.
 * vercel.json rewrites /api/* here; the app routes on the original path.
 * Built by `npm run vercel-build` (apps/server/dist must exist).
 */
import { createApp } from '../apps/server/dist/app.js'

const app = createApp()

export default app
