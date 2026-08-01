import { getInstagramWebhookCallbackUrl } from './instagram-webhook-url';

describe('getInstagramWebhookCallbackUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.WEBHOOK_BASE_URL;
    delete process.env.FRONTEND_URL;
    delete process.env.BACKEND_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses the public /api proxy for self-hosted domains', () => {
    process.env.WEBHOOK_BASE_URL = 'https://social.example.com';

    expect(getInstagramWebhookCallbackUrl()).toBe(
      'https://social.example.com/api/public/ig-webhook'
    );
  });

  it('does not duplicate /api when it is already part of the base URL', () => {
    process.env.WEBHOOK_BASE_URL = 'https://social.example.com/api/';

    expect(getInstagramWebhookCallbackUrl()).toBe(
      'https://social.example.com/api/public/ig-webhook'
    );
  });

  it('returns the proxied relative route without a configured base URL', () => {
    expect(getInstagramWebhookCallbackUrl()).toBe(
      '/api/public/ig-webhook'
    );
  });
});
