import sharp from 'sharp';
import {
  CAROUSEL_HEIGHT,
  CAROUSEL_WIDTH,
  renderCarouselSlide,
  wrapCarouselText,
} from './carousel.renderer';

describe('carousel.renderer', () => {
  it('quebra e limita textos longos', () => {
    const lines = wrapCarouselText(
      'Um titulo bastante longo para validar a quebra automatica sem estourar o layout do carrossel',
      20,
      3
    );

    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('...');
  });

  it('mantem headlines em caixa alta dentro da area segura', () => {
    expect(wrapCarouselText('VOCE ESTA RASGANDO DINHEIRO', 14, 4)).toEqual([
      'VOCE ESTA',
      'RASGANDO',
      'DINHEIRO',
    ]);
  });

  it.each(['authority', 'editorial', 'educational', 'case-study'] as const)(
    'renderiza o template %s em PNG 1080x1350',
    async (template) => {
      const buffer = await renderCarouselSlide({
        slide: {
          eyebrow: 'Estrategia',
          headline: 'Pare de perder dinheiro com este erro',
          body: 'Uma explicacao curta, clara e orientada para a acao.',
        },
        index: 0,
        total: 6,
        template,
        palette: ['#101010', '#FFD43B', '#FFFFFF'],
        brandName: 'DestinyPost',
        footer: '@destinypost',
      });
      const metadata = await sharp(buffer).metadata();

      expect(metadata.format).toBe('png');
      expect(metadata.width).toBe(CAROUSEL_WIDTH);
      expect(metadata.height).toBe(CAROUSEL_HEIGHT);
      expect(buffer.length).toBeGreaterThan(5_000);
    }
  );
});
