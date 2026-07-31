import {
  ThirdParty,
  ThirdPartyAbstract,
} from '@gitroom/nestjs-libraries/3rdparties/thirdparty.interface';

@ThirdParty({
  identifier: 'canva',
  title: 'Canva',
  description:
    'Conecte sua conta para acessar e reutilizar seus designs como modelos.',
  position: 'media-library',
  fields: [],
})
export class CanvaProvider extends ThirdPartyAbstract {
  async checkConnection(_apiKey: string) {
    return false as const;
  }

  async sendData(_apiKey: string, _data: unknown): Promise<string> {
    throw new Error('Canva uses OAuth and does not support direct API keys');
  }
}
