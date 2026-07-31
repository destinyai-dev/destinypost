import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CarouselSlide,
  CarouselTemplate,
} from '@gitroom/nestjs-libraries/chat/tools/generate.carousel.schema';

export const CAROUSEL_WIDTH = 1080;
export const CAROUSEL_HEIGHT = 1350;

const configureFontDirectory = (): void => {
  if (process.env.FONTCONFIG_FILE) return;

  try {
    const fontDirectory = join(
      process.cwd(),
      'node_modules',
      'pdfjs-dist',
      'standard_fonts'
    ).replace(/\\/g, '/');
    const configPath = join(tmpdir(), 'destinypost-fonts.conf');
    writeFileSync(
      configPath,
      `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontDirectory}</dir>
  <cachedir>${join(tmpdir(), 'destinypost-font-cache').replace(
    /\\/g,
    '/'
  )}</cachedir>
  <config>
    <rescan><int>30</int></rescan>
  </config>
</fontconfig>`
    );
    process.env.FONTCONFIG_FILE = configPath;
    process.env.FONTCONFIG_PATH = tmpdir();
  } catch {
    // Sharp will still try its native fallback if the config cannot be created.
  }
};

configureFontDirectory();

const fontStyles = `<style>
  text {
    font-family: "Liberation Sans", sans-serif !important;
  }
</style>`;

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
    return (
      '#' +
      value
        .slice(1)
        .split('')
        .map((item) => item + item)
        .join('')
        .toUpperCase()
    );
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

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export const wrapCarouselText = (
  value: string,
  maxCharacters: number,
  maxLines: number
): string[] => {
  const paragraphs = String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const lines: string[] = [];

  for (const paragraph of paragraphs.length ? paragraphs : ['']) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxCharacters || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
      if (lines.length >= maxLines) break;
    }
    if (current && lines.length < maxLines) lines.push(current);
    if (lines.length >= maxLines) break;
  }

  if (lines.length === maxLines) {
    const original = paragraphs.join(' ');
    const visible = lines.join(' ');
    if (visible.length < original.length) {
      lines[maxLines - 1] =
        lines[maxLines - 1].replace(/[.,;:!?]*$/, '').slice(0, -1) + '...';
    }
  }
  return lines;
};

const textBlock = (
  lines: string[],
  x: number,
  y: number,
  fontSize: number,
  lineHeight: number,
  color: string,
  weight: number,
  family = 'Arial, Helvetica, sans-serif'
): string => `
  <text x="${x}" y="${y}" fill="${color}" font-family="${family}" font-size="${fontSize}" font-weight="${weight}" letter-spacing="0">
    ${lines
      .map(
        (line, index) =>
          `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(
            line
          )}</tspan>`
      )
      .join('')}
  </text>`;

const paletteFor = (
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
  const muted = luminance(background) > 0.55 ? '#555555' : '#C7C7C7';
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

const typographyFor = (
  headline: string
): {
  size: number;
  lineHeight: number;
  maxCharacters: number;
  maxLines: number;
} => {
  if (headline.length <= 38) {
    return { size: 86, lineHeight: 96, maxCharacters: 14, maxLines: 4 };
  }
  if (headline.length <= 72) {
    return { size: 72, lineHeight: 82, maxCharacters: 18, maxLines: 5 };
  }
  return { size: 60, lineHeight: 70, maxCharacters: 22, maxLines: 6 };
};

const renderAuthority = (
  slide: CarouselSlide,
  index: number,
  total: number,
  brand: string,
  footer: string,
  colors: ReturnType<typeof paletteFor>
): string => {
  const type = typographyFor(slide.headline);
  const headline = wrapCarouselText(
    slide.headline,
    type.maxCharacters,
    type.maxLines
  );
  const body = slide.body ? wrapCarouselText(slide.body, 43, 6) : [];
  return `
    <rect width="1080" height="1350" fill="${colors.background}"/>
    <rect x="0" y="0" width="18" height="1350" fill="${colors.accent}"/>
    <rect x="78" y="204" width="86" height="10" fill="${colors.accent}"/>
    <text x="78" y="106" fill="${
      colors.text
    }" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700">${escapeXml(
    brand.toUpperCase()
  )}</text>
    <text x="922" y="106" fill="${
      colors.muted
    }" font-family="Arial, Helvetica, sans-serif" font-size="25" text-anchor="end">${String(
    index + 1
  ).padStart(2, '0')} / ${String(total).padStart(2, '0')}</text>
    ${
      slide.eyebrow
        ? `<text x="78" y="275" fill="${
            colors.accent
          }" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700">${escapeXml(
            slide.eyebrow.toUpperCase()
          )}</text>`
        : ''
    }
    ${textBlock(
      headline,
      78,
      slide.eyebrow ? 370 : 330,
      type.size,
      type.lineHeight,
      colors.text,
      800
    )}
    ${textBlock(body, 82, 850, 36, 52, colors.muted, 400)}
    <text x="1002" y="1220" fill="${
      colors.accent
    }" fill-opacity="0.13" font-family="Arial, Helvetica, sans-serif" font-size="290" font-weight="800" text-anchor="end">${String(
    index + 1
  ).padStart(2, '0')}</text>
    <text x="78" y="1275" fill="${
      colors.muted
    }" font-family="Arial, Helvetica, sans-serif" font-size="24">${escapeXml(
    footer
  )}</text>`;
};

const renderEditorial = (
  slide: CarouselSlide,
  index: number,
  total: number,
  brand: string,
  footer: string,
  colors: ReturnType<typeof paletteFor>
): string => {
  const type = typographyFor(slide.headline);
  const headline = wrapCarouselText(
    slide.headline,
    type.maxCharacters + 2,
    type.maxLines
  );
  const body = slide.body ? wrapCarouselText(slide.body, 46, 6) : [];
  return `
    <rect width="1080" height="1350" fill="${colors.background}"/>
    <rect x="0" y="0" width="1080" height="16" fill="${colors.accent}"/>
    <text x="78" y="112" fill="${
      colors.text
    }" font-family="Georgia, serif" font-size="30" font-weight="700">${escapeXml(
    brand
  )}</text>
    <text x="1000" y="112" fill="${
      colors.muted
    }" font-family="Arial, Helvetica, sans-serif" font-size="24" text-anchor="end">${
    index + 1
  } de ${total}</text>
    ${
      slide.eyebrow
        ? `<text x="78" y="260" fill="${
            colors.accent
          }" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="700">${escapeXml(
            slide.eyebrow.toUpperCase()
          )}</text>`
        : ''
    }
    ${textBlock(
      headline,
      78,
      slide.eyebrow ? 355 : 305,
      Math.min(type.size, 80),
      type.lineHeight,
      colors.text,
      700,
      'Georgia, serif'
    )}
    <line x1="78" y1="800" x2="1002" y2="800" stroke="${
      colors.accent
    }" stroke-width="5"/>
    ${textBlock(body, 78, 875, 35, 51, colors.muted, 400)}
    <text x="78" y="1275" fill="${
      colors.muted
    }" font-family="Arial, Helvetica, sans-serif" font-size="24">${escapeXml(
    footer
  )}</text>
    <circle cx="986" cy="1267" r="13" fill="${colors.accent}"/>`;
};

const renderEducational = (
  slide: CarouselSlide,
  index: number,
  total: number,
  brand: string,
  footer: string,
  colors: ReturnType<typeof paletteFor>
): string => {
  const type = typographyFor(slide.headline);
  const headline = wrapCarouselText(
    slide.headline,
    type.maxCharacters + 1,
    type.maxLines
  );
  const body = slide.body ? wrapCarouselText(slide.body, 44, 7) : [];
  const progress = Math.round(((index + 1) / total) * 900);
  return `
    <rect width="1080" height="1350" fill="${colors.background}"/>
    <rect x="60" y="58" width="960" height="1234" fill="none" stroke="${
      colors.text
    }" stroke-opacity="0.13" stroke-width="2"/>
    <text x="92" y="128" fill="${
      colors.text
    }" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="700">${escapeXml(
    brand.toUpperCase()
  )}</text>
    <rect x="92" y="210" width="188" height="50" fill="${colors.accent}"/>
    <text x="186" y="245" fill="${
      luminance(colors.accent) > 0.55 ? '#111111' : '#FFFFFF'
    }" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="700" text-anchor="middle">${escapeXml(
    (slide.eyebrow || `PASSO ${index + 1}`).toUpperCase()
  )}</text>
    ${textBlock(
      headline,
      92,
      365,
      Math.min(type.size, 76),
      type.lineHeight,
      colors.text,
      800
    )}
    ${textBlock(body, 96, 835, 36, 53, colors.muted, 400)}
    <rect x="90" y="1198" width="900" height="8" fill="${
      colors.text
    }" fill-opacity="0.12"/>
    <rect x="90" y="1198" width="${progress}" height="8" fill="${
    colors.accent
  }"/>
    <text x="92" y="1270" fill="${
      colors.muted
    }" font-family="Arial, Helvetica, sans-serif" font-size="24">${escapeXml(
    footer
  )}</text>
    <text x="990" y="1270" fill="${
      colors.text
    }" font-family="Arial, Helvetica, sans-serif" font-size="24" text-anchor="end">${
    index + 1
  }/${total}</text>`;
};

const renderCaseStudy = (
  slide: CarouselSlide,
  index: number,
  total: number,
  brand: string,
  footer: string,
  colors: ReturnType<typeof paletteFor>
): string => {
  const type = typographyFor(slide.headline);
  const headline = wrapCarouselText(
    slide.headline,
    type.maxCharacters + 2,
    type.maxLines
  );
  const body = slide.body ? wrapCarouselText(slide.body, 43, 7) : [];
  return `
    <rect width="1080" height="1350" fill="${colors.background}"/>
    <rect x="0" y="0" width="1080" height="230" fill="${colors.accent}"/>
    <text x="72" y="96" fill="${
      luminance(colors.accent) > 0.55 ? '#111111' : '#FFFFFF'
    }" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800">${escapeXml(
    brand.toUpperCase()
  )}</text>
    <text x="1004" y="96" fill="${
      luminance(colors.accent) > 0.55 ? '#111111' : '#FFFFFF'
    }" fill-opacity="0.7" font-family="Arial, Helvetica, sans-serif" font-size="24" text-anchor="end">${
    index + 1
  } / ${total}</text>
    <text x="72" y="181" fill="${
      luminance(colors.accent) > 0.55 ? '#111111' : '#FFFFFF'
    }" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="700">${escapeXml(
    (slide.eyebrow || 'ANALISE PRATICA').toUpperCase()
  )}</text>
    ${textBlock(
      headline,
      72,
      355,
      Math.min(type.size, 78),
      type.lineHeight,
      colors.text,
      800
    )}
    <rect x="72" y="790" width="8" height="300" fill="${colors.accent}"/>
    ${textBlock(body, 112, 840, 36, 53, colors.muted, 400)}
    <text x="72" y="1275" fill="${
      colors.muted
    }" font-family="Arial, Helvetica, sans-serif" font-size="24">${escapeXml(
    footer
  )}</text>`;
};

export const renderCarouselSlide = async (input: {
  slide: CarouselSlide;
  index: number;
  total: number;
  template: CarouselTemplate;
  palette: string[];
  brandName: string;
  footer: string;
}): Promise<Buffer> => {
  const colors = paletteFor(input.palette, input.template);
  const renderers = {
    authority: renderAuthority,
    editorial: renderEditorial,
    educational: renderEducational,
    'case-study': renderCaseStudy,
  } as const;
  const content = renderers[input.template](
    input.slide,
    input.index,
    input.total,
    input.brandName,
    input.footer,
    colors
  );
  const svg = `<svg width="${CAROUSEL_WIDTH}" height="${CAROUSEL_HEIGHT}" viewBox="0 0 ${CAROUSEL_WIDTH} ${CAROUSEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">${fontStyles}${content}</svg>`;
  const sharp = (await import('sharp')).default;
  return sharp(Buffer.from(svg))
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
};
