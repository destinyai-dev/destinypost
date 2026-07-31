import { ThirdPartyController } from './third-party.controller';
import { ThirdPartyManager } from '@gitroom/nestjs-libraries/3rdparties/thirdparty.manager';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { MockProxy } from 'jest-mock-extended';
import { Organization, Profile } from '@prisma/client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { CredentialService } from '@gitroom/nestjs-libraries/database/prisma/credentials/credential.service';

jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({
    MediaService: class MediaService {},
  })
);

describe('ThirdPartyController Canva', () => {
  let controller: ThirdPartyController;
  let thirdPartyManager: MockProxy<ThirdPartyManager> & ThirdPartyManager;
  let mediaService: MockProxy<MediaService> & MediaService;
  let credentialService: MockProxy<CredentialService> & CredentialService;

  const organization = { id: 'org-1' } as Organization;
  const profile = { id: 'profile-1' } as Profile;

  beforeEach(() => {
    thirdPartyManager = createMock<ThirdPartyManager>();
    mediaService = createMock<MediaService>();
    credentialService = createMock<CredentialService>();
    credentialService.getRaw.mockResolvedValue(null);
    controller = new ThirdPartyController(
      thirdPartyManager,
      mediaService,
      credentialService
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lista designs próprios e compartilhados com busca e paginação', async () => {
    const canvaRequest = jest
      .fn()
      .mockResolvedValue({ items: [], continuation: 'next-cursor' });
    (controller as any).canvaRequest = canvaRequest;

    const result = await controller.getCanvaDesigns(
      organization,
      'campanha verão',
      'cursor-1'
    );

    expect(canvaRequest).toHaveBeenCalledWith(
      organization.id,
      '/designs?ownership=any&sort_by=modified_descending&limit=24&query=campanha+ver%C3%A3o&continuation=cursor-1'
    );
    expect(result.continuation).toBe('next-cursor');
  });

  it('exporta cada página, salva na mídia do perfil ativo e preserva a ordem', async () => {
    const canvaRequest = jest
      .fn()
      .mockResolvedValueOnce({ job: { id: 'export-1' } })
      .mockResolvedValueOnce({
        job: {
          status: 'success',
          urls: ['https://canva.test/page-1', 'https://canva.test/page-2'],
        },
      });
    const uploadSimple = jest
      .fn()
      .mockResolvedValueOnce('media/canva-page-1.png')
      .mockResolvedValueOnce('media/canva-page-2.png');
    (controller as any).canvaRequest = canvaRequest;
    (controller as any).storage = { uploadSimple };
    mediaService.saveFile
      .mockResolvedValueOnce({
        id: 'media-1',
        path: 'media/canva-page-1.png',
      } as any)
      .mockResolvedValueOnce({
        id: 'media-2',
        path: 'media/canva-page-2.png',
      } as any);

    const result = await controller.importCanvaDesign(
      organization,
      profile,
      'design-1'
    );

    expect(uploadSimple.mock.calls.map(([url]) => url)).toEqual([
      'https://canva.test/page-1',
      'https://canva.test/page-2',
    ]);
    expect(mediaService.saveFile).toHaveBeenNthCalledWith(
      1,
      organization.id,
      'canva-page-1.png',
      'media/canva-page-1.png',
      'Canva design-1 - pagina 1',
      profile.id
    );
    expect(mediaService.saveFile).toHaveBeenNthCalledWith(
      2,
      organization.id,
      'canva-page-2.png',
      'media/canva-page-2.png',
      'Canva design-1 - pagina 2',
      profile.id
    );
    expect(result.media.map((item) => item.id)).toEqual(['media-1', 'media-2']);
  });

  it('revoga o token e remove somente a conexão local', async () => {
    thirdPartyManager.getAllThirdPartiesByOrganization.mockResolvedValue([
      { id: 'canva-integration', identifier: 'canva' },
    ] as any);
    thirdPartyManager.getIntegrationById.mockResolvedValue({
      id: 'canva-integration',
      apiKey: 'encrypted-token',
    } as any);
    jest.spyOn(AuthService, 'fixedDecryption').mockReturnValue(
      JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 60_000,
        scope: 'profile:read',
        userId: 'user-1',
        teamId: 'team-1',
        displayName: 'Cliente Canva',
      })
    );
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    process.env.CANVA_CLIENT_ID = 'client-id';
    process.env.CANVA_CLIENT_SECRET = 'client-secret';
    process.env.FRONTEND_URL = 'https://saas.test';

    await expect(controller.disconnectCanva(organization)).resolves.toEqual({
      success: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.canva.com/rest/v1/oauth/revoke',
      expect.objectContaining({ method: 'POST' })
    );
    expect(thirdPartyManager.deleteIntegration).toHaveBeenCalledWith(
      organization.id,
      'canva-integration'
    );
    expect(mediaService.deleteMedia).not.toHaveBeenCalled();
  });

  it('prioriza as credenciais Canva salvas na interface', async () => {
    credentialService.getRaw.mockResolvedValue({
      clientId: 'workspace-client-id',
      clientSecret: 'workspace-client-secret',
    });
    process.env.CANVA_CLIENT_ID = 'env-client-id';
    process.env.CANVA_CLIENT_SECRET = 'env-client-secret';
    process.env.FRONTEND_URL = 'https://saas.test';

    const config = await (controller as any).getCanvaConfig(organization.id);

    expect(config.clientId).toBe('workspace-client-id');
    expect(config.clientSecret).toBe('workspace-client-secret');
    expect(config.redirectUri).toBe(
      'https://saas.test/api/third-party/canva/oauth/callback'
    );
  });
});
