jest.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: class PrismaRepository {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/flows/flows.service',
  () => ({ FlowsService: class FlowsService {} })
);
jest.mock('@gitroom/nestjs-libraries/crypto/encryption.service', () => ({
  EncryptionService: class EncryptionService {},
}));
jest.mock('@gitroom/nestjs-libraries/crypto/integration-token.helper', () => ({
  decryptIntegrationToken: jest.fn(
    (_encryption: unknown, token: string) => token
  ),
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/social/instagram-messaging.service',
  () => ({ InstagramMessagingService: class InstagramMessagingService {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/integrations/social/instagram-route.resolver',
  () => ({
    resolveIgRoute: jest.fn(async (integration: { token: string }) => ({
      host: 'graph.facebook.com',
      token: integration.token,
      mode: 'page',
    })),
  })
);

import { InstagramCommentPollingService } from './instagram-comment-polling.service';

describe('InstagramCommentPollingService', () => {
  const originalSelfHosted = process.env.SELF_HOSTED;
  const originalPollingEnabled = process.env.IG_COMMENT_POLLING_ENABLED;
  const originalFetch = global.fetch;

  const activeFlow = {
    triggerPostIds: JSON.stringify(['media-1']),
    updatedAt: new Date(Date.now() - 60 * 60_000),
    nodes: [
      {
        data: JSON.stringify({
          triggerType: 'comment_on_post',
          mode: 'specific',
        }),
      },
    ],
    integration: {
      id: 'integration-1',
      internalId: 'ig-account-1',
      organizationId: 'org-1',
      profileId: 'profile-1',
      providerIdentifier: 'instagram',
      token: 'page-token',
    },
  };

  const createService = (flows = [activeFlow]) => {
    const prisma = {
      model: {
        flow: {
          findMany: jest.fn().mockResolvedValue(flows),
        },
      },
    };
    const flowsService = {
      handleIncomingComment: jest.fn().mockResolvedValue([]),
    };
    const instagramMessaging = {
      resolveIgUserToken: jest.fn().mockResolvedValue(null),
    };

    const service = new InstagramCommentPollingService(
      prisma as any,
      flowsService as any,
      {} as any,
      instagramMessaging as any
    );

    return { service, prisma, flowsService };
  };

  beforeEach(() => {
    process.env.SELF_HOSTED = 'true';
    delete process.env.IG_COMMENT_POLLING_ENABLED;
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (originalSelfHosted === undefined) delete process.env.SELF_HOSTED;
    else process.env.SELF_HOSTED = originalSelfHosted;

    if (originalPollingEnabled === undefined) {
      delete process.env.IG_COMMENT_POLLING_ENABLED;
    } else {
      process.env.IG_COMMENT_POLLING_ENABLED = originalPollingEnabled;
    }
    global.fetch = originalFetch;
  });

  it('dispatches recent comments from active self-hosted flows', async () => {
    const { service, flowsService } = createService();
    const timestamp = new Date().toISOString();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'comment-1',
            text: 'Oi',
            username: 'cliente',
            timestamp,
            from: { id: 'commenter-1', username: 'cliente' },
          },
        ],
      }),
    } as any);

    await service.poll();

    expect(flowsService.handleIncomingComment).toHaveBeenCalledWith({
      integrationId: 'integration-1',
      organizationId: 'org-1',
      igCommentId: 'comment-1',
      igCommenterId: 'commenter-1',
      igCommenterName: 'cliente',
      igMediaId: 'media-1',
      commentText: 'Oi',
      commentCreatedAt: new Date(timestamp),
    });
  });

  it('ignores old comments and comments made by the connected account', async () => {
    const { service, flowsService } = createService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'old-comment',
            text: 'old',
            timestamp: new Date(Date.now() - 31 * 60_000).toISOString(),
            from: { id: 'commenter-1' },
          },
          {
            id: 'self-comment',
            text: 'self',
            timestamp: new Date().toISOString(),
            from: { id: 'ig-account-1' },
          },
        ],
      }),
    } as any);

    await service.poll();

    expect(flowsService.handleIncomingComment).not.toHaveBeenCalled();
  });

  it('does not poll when the fallback is explicitly disabled', async () => {
    process.env.IG_COMMENT_POLLING_ENABLED = 'false';
    const { service, prisma } = createService();
    global.fetch = jest.fn();

    await service.poll();

    expect(prisma.model.flow.findMany).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
