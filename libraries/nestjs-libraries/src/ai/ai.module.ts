import { Module } from '@nestjs/common';
import { AiCatalogService } from './ai-catalog.service';
import { AiClientFactory } from './ai-client.factory';
import { AiCredentialRepository } from './ai-credential.repository';
import { AiCredentialService } from './ai-credential.service';
import { AiImageService } from './ai-image.service';
import { AiProviderResolverService } from './ai-provider-resolver.service';
import { AiProviderTestService } from './ai-provider-test.service';
import { AiTextService } from './ai-text.service';
import { AiVideoService } from './ai-video.service';
import { AiWebSearchService } from './ai-web-search.service';
import { InstagramStrategyService } from './instagram-strategy.service';

// DatabaseModule e Global e ja exporta PrismaRepository + EncryptionService.
@Module({
  providers: [
    AiCatalogService,
    AiClientFactory,
    AiCredentialRepository,
    AiCredentialService,
    AiImageService,
    AiProviderResolverService,
    AiProviderTestService,
    AiTextService,
    AiVideoService,
    AiWebSearchService,
    InstagramStrategyService,
  ],
  exports: [
    AiCatalogService,
    AiClientFactory,
    AiCredentialRepository,
    AiCredentialService,
    AiImageService,
    AiProviderResolverService,
    AiProviderTestService,
    AiTextService,
    AiVideoService,
    AiWebSearchService,
    InstagramStrategyService,
  ],
})
export class AiModule {}
