const IG_WEBHOOK_PATH = '/api/public/ig-webhook';

export function getInstagramWebhookCallbackUrl(): string {
  const rawBase =
    process.env.WEBHOOK_BASE_URL ||
    process.env.FRONTEND_URL ||
    process.env.BACKEND_URL ||
    '';
  const base = rawBase.replace(/\/$/, '');

  if (!base) {
    return IG_WEBHOOK_PATH;
  }

  // Self-hosted installations expose Nest through the frontend /api proxy.
  // Also accept WEBHOOK_BASE_URL ending in /api to avoid duplicating it.
  if (base.endsWith('/api')) {
    return `${base}/public/ig-webhook`;
  }

  return `${base}${IG_WEBHOOK_PATH}`;
}
