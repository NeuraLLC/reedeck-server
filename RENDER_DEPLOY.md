No, you do **not** run the worker in your build command. The build command is only for compiling your code. The worker needs to run continuously as a separate process.

## How to Setup the Worker on Render

You should create a separate **Background Worker** service on Render. This service will run alongside your Web Service but handles the background jobs (emails, AI processing).

1.  **Create New Service**: Go to Render Dashboard > New > **Background Worker**.
2.  **Connect Repo**: Select your `reedeck-server` repository.
3.  **Configure**:
    *   **Build Command**: `npm run build` (Same as your web service)
    *   **Start Command**: `node dist/workers/index.js`
    *   **Environment Variables**: Copy all variables from your Web Service to this new Worker Service (especially `REDIS_URL`, `DATABASE_URL`, `RESEND_API_KEY`, etc.).

### Why a separate service?
*   **Scaling**: You can scale your worker independently from your API.
*   **Reliability**: If your worker crashes (e.g., memory limit), it won't take down your API.
*   **Architecture**: Render prevents "Web Services" from running background tasks reliably because they scale to zero or restart often. Background Workers are designed for this.

### Quick Tip
To make it easier, you can add this script to your `package.json`:
```json
"start:worker": "node dist/workers/index.js"
```
Then your Render start command can just be `npm run start:worker`.
