import {
  buildEditableCarouselDesign,
  EDITABLE_CAROUSEL_HEIGHT,
  EDITABLE_CAROUSEL_WIDTH,
} from './carousel.design';

describe('carousel.design', () => {
  const slides = [
    { eyebrow: 'Capa', headline: 'Uma promessa forte para abrir o carrossel' },
    {
      eyebrow: 'Diagnostico',
      headline: 'O problema que impede o resultado',
      body: 'Uma explicacao curta, objetiva e facil de editar.',
      imageQuery: 'empreendedor analisando resultados',
    },
    { eyebrow: 'CTA', headline: 'Comente QUERO para receber o material' },
  ];

  it.each(['authority', 'editorial', 'educational', 'case-study'] as const)(
    'creates a valid multipage %s design',
    (template) => {
      const design = buildEditableCarouselDesign({
        template,
        brandName: 'Destiny Post',
        username: 'destinypost',
        palette: ['#101010', '#D6AF36', '#FFFFFF'],
        slides,
      });

      expect(design.width).toBe(EDITABLE_CAROUSEL_WIDTH);
      expect(design.height).toBe(EDITABLE_CAROUSEL_HEIGHT);
      expect(design.schemaVersion).toBe(4);
      expect(design.pages).toHaveLength(3);
      expect(design.pages[1].custom.imageQuery).toBe(
        'empreendedor analisando resultados'
      );
      expect(
        design.pages.every((page) =>
          page.children.some((element) => element.name === 'headline')
        )
      ).toBe(true);
      expect(
        design.pages.every((page) =>
          page.children.some((element) => element.name === 'footer')
        )
      ).toBe(true);
    }
  );

  it('keeps decorative elements editable and uses a replaceable visual', () => {
    const design = buildEditableCarouselDesign({
      template: 'authority',
      brandName: 'Marca',
      palette: ['black', 'gold', 'white'],
      slides,
    });
    const visual = design.pages[1].children.find(
      (element) => element.name === 'Imagem principal - empreendedor analisando resultados'
    );

    expect(visual).toMatchObject({
      type: 'image',
      contentEditable: true,
      removable: true,
      custom: {
        role: 'key-visual',
        imageQuery: 'empreendedor analisando resultados',
      },
    });
    expect(String(visual?.src)).toContain('data:image/svg+xml');
  });
});
