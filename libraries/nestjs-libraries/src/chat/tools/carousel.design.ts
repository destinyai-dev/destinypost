import {
  CarouselSlide,
  CarouselTemplate,
} from '@gitroom/nestjs-libraries/chat/tools/generate.carousel.schema';

export const EDITABLE_CAROUSEL_WIDTH = 1080;
export const EDITABLE_CAROUSEL_HEIGHT = 1350;

export type EditableCarouselSlide = CarouselSlide & {
  imageQuery?: string;
  imageUrl?: string;
};

export type EditableCarouselInput = {
  template: CarouselTemplate;
  brandName: string;
  username?: string;
  palette: string[];
  footer?: string;
  slides: EditableCarouselSlide[];
};

type DesignElement = Record<string, unknown>;

export type EditableCarouselDesign = {
  schemaVersion: number;
  width: number;
  height: number;
  unit: 'px';
  dpi: number;
  fonts: unknown[];
  audios: unknown[];
  custom: Record<string, unknown>;
  pages: Array<{
    id: string;
    background: string;
    custom: Record<string, unknown>;
    children: DesignElement[];
  }>;
};

const COLOR_NAMES: Record<string, string> = {
  black: '#101010',
  white: '#FFFFFF',
  gold: '#D6AF36',
  yellow: '#FFD43B',
  red: '#E5484D',
  blue: '#246BFD',
  green: '#1B9A59',
  purple: '#7755CC',
};

const normalizeColor = (raw: string | undefined, fallback: string): string => {
  const value = String(raw || '').trim();
  const named = COLOR_NAMES[value.toLowerCase()];
  if (named) return named;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return `#${value
      .slice(1)
      .split('')
      .map((character) => character + character)
      .join('')
      .toUpperCase()}`;
  }
  return fallback;
};

const luminance = (hex: string): number => {
  const rgb = [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16)
  );
  return (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) / 255;
};

const chroma = (hex: string): number => {
  const rgb = [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16)
  );
  return Math.max(...rgb) - Math.min(...rgb);
};

export const resolveEditableCarouselPalette = (
  palette: string[],
  template: CarouselTemplate
): { background: string; text: string; muted: string; accent: string } => {
  const normalized = palette.map((color, index) =>
    normalizeColor(color, index === 0 ? '#101010' : '#FFD43B')
  );
  const wantsLight = template === 'editorial' || template === 'educational';
  const background =
    normalized.find((color) =>
      wantsLight ? luminance(color) > 0.72 : luminance(color) < 0.28
    ) ?? (wantsLight ? '#F7F7F2' : '#101010');
  const text = luminance(background) > 0.55 ? '#111111' : '#FFFFFF';
  const muted = luminance(background) > 0.55 ? '#565656' : '#C7C7C7';
  const accent =
    normalized.find(
      (color) =>
        color !== background &&
        chroma(color) > 35 &&
        Math.abs(luminance(color) - luminance(background)) > 0.2
    ) ??
    normalized.find(
      (color) =>
        color !== background &&
        Math.abs(luminance(color) - luminance(background)) > 0.28
    ) ??
    (luminance(background) > 0.55 ? '#246BFD' : '#FFD43B');
  return { background, text, muted, accent };
};

const id = (page: number, name: string): string =>
  `carousel-${page + 1}-${name}`;

const textElement = (
  page: number,
  name: string,
  text: string,
  props: Record<string, unknown>
): DesignElement => ({
  id: id(page, name),
  type: 'text',
  name,
  text,
  fontFamily: 'Arial',
  fontStyle: 'normal',
  fontWeight: 'normal',
  textDecoration: '',
  textTransform: 'none',
  align: 'left',
  verticalAlign: 'top',
  lineHeight: 1.12,
  letterSpacing: 0,
  rotation: 0,
  opacity: 1,
  showInExport: true,
  selectable: true,
  draggable: true,
  contentEditable: true,
  removable: true,
  resizable: true,
  styleEditable: true,
  ...props,
});

const figureElement = (
  page: number,
  name: string,
  props: Record<string, unknown>
): DesignElement => ({
  id: id(page, name),
  type: 'figure',
  name,
  subType: 'rect',
  rotation: 0,
  opacity: 1,
  strokeWidth: 0,
  showInExport: true,
  selectable: true,
  draggable: true,
  removable: true,
  resizable: true,
  styleEditable: true,
  ...props,
});

const placeholderSvg = (
  background: string,
  accent: string,
  index: number
): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="${background}"/><circle cx="820" cy="260" r="330" fill="${accent}" opacity=".92"/><path d="M-80 1160L800 280L1190 670L310 1550Z" fill="${accent}" opacity=".34"/><circle cx="250" cy="1080" r="190" fill="none" stroke="${accent}" stroke-width="24" opacity=".72"/><text x="820" y="300" text-anchor="middle" font-family="Arial" font-size="124" font-weight="700" fill="${background}" opacity=".72">${String(
    index + 1
  ).padStart(2, '0')}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const imageElement = (
  page: number,
  slide: EditableCarouselSlide,
  colors: ReturnType<typeof resolveEditableCarouselPalette>,
  props: Record<string, unknown>
): DesignElement => ({
  id: id(page, 'key-visual'),
  type: 'image',
  name: `Imagem principal - ${slide.imageQuery || slide.headline}`,
  src:
    slide.imageUrl || placeholderSvg(colors.background, colors.accent, page),
  keepRatio: false,
  stretchEnabled: false,
  cropX: 0.5,
  cropY: 0.5,
  rotation: 0,
  opacity: 1,
  showInExport: true,
  selectable: true,
  draggable: true,
  contentEditable: true,
  removable: true,
  resizable: true,
  ...props,
  custom: {
    role: 'key-visual',
    imageQuery: slide.imageQuery || slide.headline,
  },
});

const headlineSize = (headline: string, hasImage: boolean): number => {
  const base = hasImage ? 64 : 78;
  if (headline.length <= 42) return base;
  if (headline.length <= 78) return base - 10;
  return base - 18;
};

const baseFooter = (
  page: number,
  total: number,
  footer: string,
  colors: ReturnType<typeof resolveEditableCarouselPalette>
): DesignElement[] => [
  textElement(page, 'footer', footer, {
    x: 76,
    y: 1262,
    width: 700,
    height: 40,
    fontSize: 24,
    fill: colors.muted,
  }),
  textElement(page, 'counter', `${page + 1}/${total}`, {
    x: 882,
    y: 1262,
    width: 120,
    height: 40,
    fontSize: 24,
    fontWeight: 'bold',
    fill: colors.text,
    align: 'right',
  }),
];

const authorityPage = (
  slide: EditableCarouselSlide,
  page: number,
  total: number,
  brandName: string,
  footer: string,
  colors: ReturnType<typeof resolveEditableCarouselPalette>
): DesignElement[] => {
  const hasVisual = page > 0 && page < total - 1;
  const textWidth = hasVisual ? 540 : 900;
  return [
    figureElement(page, 'accent-bar', {
      x: 0,
      y: 0,
      width: 18,
      height: EDITABLE_CAROUSEL_HEIGHT,
      fill: colors.accent,
    }),
    ...(hasVisual
      ? [
          imageElement(page, slide, colors, {
            x: 650,
            y: 175,
            width: 360,
            height: 900,
            cornerRadius: 18,
          }),
        ]
      : [
          figureElement(page, 'accent-block', {
            x: 78,
            y: 220,
            width: 96,
            height: 12,
            fill: colors.accent,
          }),
        ]),
    textElement(page, 'brand', brandName.toUpperCase(), {
      x: 78,
      y: 76,
      width: 620,
      height: 45,
      fontSize: 28,
      fontWeight: 'bold',
      fill: colors.text,
    }),
    ...(slide.eyebrow
      ? [
          textElement(page, 'eyebrow', slide.eyebrow.toUpperCase(), {
            x: 78,
            y: hasVisual ? 220 : 275,
            width: textWidth,
            height: 44,
            fontSize: 25,
            fontWeight: 'bold',
            fill: colors.accent,
          }),
        ]
      : []),
    textElement(page, 'headline', slide.headline, {
      x: 78,
      y: slide.eyebrow ? (hasVisual ? 300 : 360) : hasVisual ? 245 : 315,
      width: textWidth,
      height: 480,
      fontSize: headlineSize(slide.headline, hasVisual),
      fontWeight: 'bold',
      fill: colors.text,
    }),
    ...(slide.body
      ? [
          textElement(page, 'body', slide.body, {
            x: 82,
            y: hasVisual ? 790 : 850,
            width: textWidth,
            height: 270,
            fontSize: 34,
            lineHeight: 1.32,
            fill: colors.muted,
          }),
        ]
      : []),
    textElement(page, 'watermark', String(page + 1).padStart(2, '0'), {
      x: hasVisual ? 720 : 650,
      y: 930,
      width: 350,
      height: 300,
      fontSize: 250,
      fontWeight: 'bold',
      fill: colors.accent,
      opacity: 0.12,
      align: 'right',
    }),
    ...baseFooter(page, total, footer, colors),
  ];
};

const editorialPage = (
  slide: EditableCarouselSlide,
  page: number,
  total: number,
  brandName: string,
  footer: string,
  colors: ReturnType<typeof resolveEditableCarouselPalette>
): DesignElement[] => {
  const hasVisual = page % 2 === 1 && page < total - 1;
  return [
    figureElement(page, 'top-rule', {
      x: 0,
      y: 0,
      width: EDITABLE_CAROUSEL_WIDTH,
      height: 16,
      fill: colors.accent,
    }),
    ...(hasVisual
      ? [
          imageElement(page, slide, colors, {
            x: 570,
            y: 175,
            width: 430,
            height: 1010,
            cornerRadius: 10,
          }),
        ]
      : []),
    textElement(page, 'brand', brandName, {
      x: 76,
      y: 70,
      width: 650,
      height: 50,
      fontFamily: 'Georgia',
      fontSize: 31,
      fontWeight: 'bold',
      fill: colors.text,
    }),
    ...(slide.eyebrow
      ? [
          textElement(page, 'eyebrow', slide.eyebrow.toUpperCase(), {
            x: 76,
            y: 218,
            width: hasVisual ? 430 : 900,
            height: 42,
            fontSize: 24,
            fontWeight: 'bold',
            fill: colors.accent,
          }),
        ]
      : []),
    textElement(page, 'headline', slide.headline, {
      x: 76,
      y: slide.eyebrow ? 300 : 230,
      width: hasVisual ? 430 : 900,
      height: 480,
      fontFamily: 'Georgia',
      fontSize: headlineSize(slide.headline, hasVisual),
      fontWeight: 'bold',
      lineHeight: 1.08,
      fill: colors.text,
    }),
    figureElement(page, 'divider', {
      x: 76,
      y: hasVisual ? 730 : 790,
      width: hasVisual ? 430 : 900,
      height: 5,
      fill: colors.accent,
    }),
    ...(slide.body
      ? [
          textElement(page, 'body', slide.body, {
            x: 76,
            y: hasVisual ? 785 : 850,
            width: hasVisual ? 430 : 900,
            height: 310,
            fontSize: 34,
            lineHeight: 1.36,
            fill: colors.muted,
          }),
        ]
      : []),
    ...baseFooter(page, total, footer, colors),
  ];
};

const educationalPage = (
  slide: EditableCarouselSlide,
  page: number,
  total: number,
  brandName: string,
  footer: string,
  colors: ReturnType<typeof resolveEditableCarouselPalette>
): DesignElement[] => {
  const hasVisual = page > 0 && page < total - 1 && page % 2 === 0;
  const progressWidth = Math.round(((page + 1) / total) * 900);
  return [
    figureElement(page, 'frame', {
      x: 56,
      y: 54,
      width: 968,
      height: 1238,
      fill: 'rgba(255,255,255,0)',
      stroke: colors.text,
      strokeWidth: 2,
      opacity: 0.13,
    }),
    ...(hasVisual
      ? [
          imageElement(page, slide, colors, {
            x: 590,
            y: 190,
            width: 390,
            height: 390,
            cornerRadius: 24,
          }),
        ]
      : []),
    textElement(page, 'brand', brandName.toUpperCase(), {
      x: 90,
      y: 82,
      width: 650,
      height: 44,
      fontSize: 27,
      fontWeight: 'bold',
      fill: colors.text,
    }),
    figureElement(page, 'step-tag', {
      x: 90,
      y: 190,
      width: 196,
      height: 54,
      fill: colors.accent,
      cornerRadius: 8,
    }),
    textElement(
      page,
      'eyebrow',
      (slide.eyebrow || `PASSO ${page + 1}`).toUpperCase(),
      {
        x: 108,
        y: 204,
        width: 160,
        height: 35,
        fontSize: 22,
        fontWeight: 'bold',
        fill: luminance(colors.accent) > 0.55 ? '#111111' : '#FFFFFF',
        align: 'center',
      }
    ),
    textElement(page, 'headline', slide.headline, {
      x: 90,
      y: 320,
      width: hasVisual ? 450 : 900,
      height: 420,
      fontSize: headlineSize(slide.headline, hasVisual),
      fontWeight: 'bold',
      fill: colors.text,
    }),
    ...(slide.body
      ? [
          textElement(page, 'body', slide.body, {
            x: 94,
            y: hasVisual ? 690 : 780,
            width: 880,
            height: 330,
            fontSize: 35,
            lineHeight: 1.38,
            fill: colors.muted,
          }),
        ]
      : []),
    figureElement(page, 'progress-track', {
      x: 90,
      y: 1196,
      width: 900,
      height: 9,
      fill: colors.text,
      opacity: 0.12,
    }),
    figureElement(page, 'progress-value', {
      x: 90,
      y: 1196,
      width: progressWidth,
      height: 9,
      fill: colors.accent,
    }),
    ...baseFooter(page, total, footer, colors),
  ];
};

const caseStudyPage = (
  slide: EditableCarouselSlide,
  page: number,
  total: number,
  brandName: string,
  footer: string,
  colors: ReturnType<typeof resolveEditableCarouselPalette>
): DesignElement[] => {
  const hasVisual = page > 0 && page < total - 1;
  return [
    figureElement(page, 'header', {
      x: 0,
      y: 0,
      width: EDITABLE_CAROUSEL_WIDTH,
      height: 225,
      fill: colors.accent,
    }),
    ...(hasVisual
      ? [
          imageElement(page, slide, colors, {
            x: 640,
            y: 300,
            width: 360,
            height: 540,
            cornerRadius: 18,
          }),
        ]
      : []),
    textElement(page, 'brand', brandName.toUpperCase(), {
      x: 70,
      y: 68,
      width: 660,
      height: 46,
      fontSize: 28,
      fontWeight: 'bold',
      fill: luminance(colors.accent) > 0.55 ? '#111111' : '#FFFFFF',
    }),
    textElement(
      page,
      'eyebrow',
      (slide.eyebrow || `ANALISE ${page + 1}`).toUpperCase(),
      {
        x: 70,
        y: 145,
        width: 850,
        height: 38,
        fontSize: 24,
        fontWeight: 'bold',
        fill: luminance(colors.accent) > 0.55 ? '#111111' : '#FFFFFF',
        opacity: 0.78,
      }
    ),
    textElement(page, 'headline', slide.headline, {
      x: 70,
      y: 300,
      width: hasVisual ? 510 : 920,
      height: 440,
      fontSize: headlineSize(slide.headline, hasVisual),
      fontWeight: 'bold',
      fill: colors.text,
    }),
    ...(slide.body
      ? [
          figureElement(page, 'body-card', {
            x: 70,
            y: hasVisual ? 760 : 790,
            width: hasVisual ? 510 : 920,
            height: 300,
            fill: colors.text,
            opacity: 0.06,
            cornerRadius: 18,
          }),
          textElement(page, 'body', slide.body, {
            x: 104,
            y: hasVisual ? 805 : 835,
            width: hasVisual ? 442 : 852,
            height: 220,
            fontSize: 34,
            lineHeight: 1.36,
            fill: colors.muted,
          }),
        ]
      : []),
    ...baseFooter(page, total, footer, colors),
  ];
};

export const buildEditableCarouselDesign = (
  input: EditableCarouselInput
): EditableCarouselDesign => {
  const template = input.template || 'authority';
  const colors = resolveEditableCarouselPalette(input.palette || [], template);
  const footer =
    input.footer ||
    (input.username
      ? `@${String(input.username).replace(/^@/, '')}`
      : input.brandName);
  const total = input.slides.length;

  return {
    schemaVersion: 4,
    width: EDITABLE_CAROUSEL_WIDTH,
    height: EDITABLE_CAROUSEL_HEIGHT,
    unit: 'px',
    dpi: 72,
    fonts: [],
    audios: [],
    custom: {
      kind: 'instagram-carousel',
      template,
      brandName: input.brandName,
      palette: input.palette,
    },
    pages: input.slides.map((slide, page) => {
      const common = [
        slide,
        page,
        total,
        input.brandName,
        footer,
        colors,
      ] as const;
      const children =
        template === 'editorial'
          ? editorialPage(...common)
          : template === 'educational'
          ? educationalPage(...common)
          : template === 'case-study'
          ? caseStudyPage(...common)
          : authorityPage(...common);
      return {
        id: `carousel-page-${page + 1}`,
        background: colors.background,
        custom: {
          slideIndex: page + 1,
          imageQuery: slide.imageQuery || slide.headline,
          role:
            page === 0 ? 'cover' : page === total - 1 ? 'cta' : 'content',
        },
        children,
      };
    }),
  };
};
