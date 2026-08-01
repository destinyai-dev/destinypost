import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { FlowNodeType, FlowStatus } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { FlowsService } from '@gitroom/nestjs-libraries/database/prisma/flows/flows.service';
import { EncryptionService } from '@gitroom/nestjs-libraries/crypto/encryption.service';
import { decryptIntegrationToken } from '@gitroom/nestjs-libraries/crypto/integration-token.helper';
import { InstagramMessagingService } from '@gitroom/nestjs-libraries/integrations/social/instagram-messaging.service';
import { resolveIgRoute } from '@gitroom/nestjs-libraries/integrations/social/instagram-route.resolver';

const POLL_INTERVAL_MS = 15_000;
const INITIAL_LOOKBACK_MS = 30 * 60_000;
const OVERLAP_MS = 30_000;
const MAX_COMMENTS_PER_MEDIA = 25;

type PollingRoute = Awaited<ReturnType<typeof resolveIgRoute>>;

interface PollingIntegration {
  id: string;
  internalId: string;
  organizationId: string;
  profileId: string | null;
  providerIdentifier: string;
  token: string;
}

interface PollingFlow {
  triggerPostIds: string | null;
  updatedAt: Date;
  nodes: Array<{ data: string }>;
  integration: PollingIntegration;
}

interface PollingTarget {
  integration: PollingFlow['integration'];
  mediaId: string;
  route: PollingRoute;
}

@Injectable()
export class InstagramCommentPollingService {
  private readonly logger = new Logger(InstagramCommentPollingService.name);
  private polling = false;
  private pollAfter = new Date(Date.now() - INITIAL_LOOKBACK_MS);

  constructor(
    private readonly prisma: PrismaRepository<'flow'>,
    private readonly flowsService: FlowsService,
    private readonly encryption: EncryptionService,
    private readonly instagramMessaging: InstagramMessagingService
  ) {}

  @Interval('instagram-comment-fallback', POLL_INTERVAL_MS)
  async poll(): Promise<void> {
    if (!this.isEnabled() || this.polling) return;

    this.polling = true;
    const cycleStartedAt = new Date();
    let cycleSucceeded = true;

    try {
      const flows = await this.findActiveFlows();
      const targets = await this.buildTargets(flows);

      for (const target of targets.values()) {
        try {
          await this.pollTarget(target, this.pollAfter);
        } catch (error) {
          cycleSucceeded = false;
          this.logger.warn(
            `Instagram comment fallback failed for media ${target.mediaId}: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          );
        }
      }
    } catch (error) {
      cycleSucceeded = false;
      this.logger.warn(
        `Instagram comment fallback cycle failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    } finally {
      if (cycleSucceeded) {
        this.pollAfter = new Date(cycleStartedAt.getTime() - OVERLAP_MS);
      }
      this.polling = false;
    }
  }

  private isEnabled(): boolean {
    if (process.env.IG_COMMENT_POLLING_ENABLED === 'false') return false;
    return (
      process.env.IG_COMMENT_POLLING_ENABLED === 'true' ||
      process.env.SELF_HOSTED === 'true'
    );
  }

  private findActiveFlows() {
    return this.prisma.model.flow.findMany({
      where: {
        status: FlowStatus.ACTIVE,
        deletedAt: null,
        integration: {
          providerIdentifier: {
            in: ['instagram', 'instagram-standalone'],
          },
          disabled: false,
          deletedAt: null,
        },
      },
      include: {
        nodes: {
          where: { type: FlowNodeType.TRIGGER },
          take: 1,
        },
        integration: {
          select: {
            id: true,
            internalId: true,
            organizationId: true,
            profileId: true,
            providerIdentifier: true,
            token: true,
          },
        },
      },
    });
  }

  private async buildTargets(flows: PollingFlow[]) {
    const targets = new Map<string, PollingTarget>();
    const routeCache = new Map<string, PollingRoute>();
    const mediaCache = new Map<
      string,
      Array<{ id: string; timestamp?: string }>
    >();

    for (const flow of flows) {
      const trigger = this.parseTrigger(flow.nodes[0]?.data);
      if (trigger.triggerType !== 'comment_on_post') continue;

      let route = routeCache.get(flow.integration.id);
      if (!route) {
        route = await resolveIgRoute(
          {
            ...flow.integration,
            token: decryptIntegrationToken(
              this.encryption,
              flow.integration.token
            ),
          },
          this.instagramMessaging
        );
        routeCache.set(flow.integration.id, route);
      }

      let mediaIds = this.parsePostIds(flow.triggerPostIds);
      if (mediaIds.length === 0 && trigger.mode !== 'specific') {
        let media = mediaCache.get(flow.integration.id);
        if (!media) {
          media = await this.fetchRecentMedia(flow.integration, route);
          mediaCache.set(flow.integration.id, media);
        }

        mediaIds = media
          .filter((item) => {
            if (trigger.mode !== 'next_publication') return true;
            const timestamp = Date.parse(item.timestamp || '');
            return (
              Number.isFinite(timestamp) &&
              timestamp >= flow.updatedAt.getTime()
            );
          })
          .map((item) => item.id);
      }

      for (const mediaId of mediaIds) {
        targets.set(`${flow.integration.id}:${mediaId}`, {
          integration: flow.integration,
          mediaId,
          route,
        });
      }
    }

    return targets;
  }

  private async fetchRecentMedia(
    integration: PollingFlow['integration'],
    route: PollingRoute
  ): Promise<Array<{ id: string; timestamp?: string }>> {
    const params = new URLSearchParams({
      fields: 'id,timestamp',
      limit: '25',
      access_token: route.token,
    });
    const response = await fetch(
      `https://${route.host}/v25.0/${integration.internalId}/media?${params}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    const body = await response.json();
    if (!response.ok) {
      throw new Error(
        body?.error?.message || `Meta media request failed (${response.status})`
      );
    }
    return Array.isArray(body?.data) ? body.data : [];
  }

  private async pollTarget(target: PollingTarget, after: Date): Promise<void> {
    const params = new URLSearchParams({
      fields: 'id,text,username,timestamp,from',
      limit: String(MAX_COMMENTS_PER_MEDIA),
      access_token: target.route.token,
    });
    const response = await fetch(
      `https://${target.route.host}/v25.0/${target.mediaId}/comments?${params}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    const body = await response.json();
    if (!response.ok) {
      throw new Error(
        body?.error?.message ||
          `Meta comments request failed (${response.status})`
      );
    }

    const comments = Array.isArray(body?.data) ? [...body.data].reverse() : [];
    for (const comment of comments) {
      const createdAt = new Date(comment.timestamp);
      const commenterId = String(comment.from?.id || '');
      if (
        !comment.id ||
        !commenterId ||
        Number.isNaN(createdAt.getTime()) ||
        createdAt < after ||
        commenterId === target.integration.internalId
      ) {
        continue;
      }

      this.logger.log(
        `Instagram comment fallback dispatching ${comment.id} on media ${target.mediaId}`
      );
      await this.flowsService.handleIncomingComment({
        integrationId: target.integration.id,
        organizationId: target.integration.organizationId,
        igCommentId: String(comment.id),
        igCommenterId: commenterId,
        igCommenterName: comment.username || comment.from?.username,
        igMediaId: target.mediaId,
        commentText: comment.text || '',
        commentCreatedAt: createdAt,
      });
    }
  }

  private parsePostIds(value: string | null): string[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.map(String).filter((item) => item.length > 0)
        : [];
    } catch {
      return [];
    }
  }

  private parseTrigger(value?: string): {
    triggerType?: string;
    mode?: string;
  } {
    if (!value) return {};
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
}
