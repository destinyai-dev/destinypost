import { generateImageInputSchema } from './generate.image.schema';

describe('generateImageInputSchema', () => {
  const requiredInput = {
    prompt: 'Um carrossel minimalista',
    mode: 'T2I' as const,
    aspectRatio: '1:1' as const,
  };

  it('ignora objetos indevidos nos campos opcionais', () => {
    const parsed = generateImageInputSchema.parse({
      ...requiredInput,
      referenceImageUrl: { reason: 'nenhuma referencia fornecida' },
      style: { reason: 'usar o DNA da marca' },
      manualPrompt: { reason: 'enriquecer automaticamente' },
    });

    expect(parsed.referenceImageUrl).toBeUndefined();
    expect(parsed.style).toBeUndefined();
    expect(parsed.manualPrompt).toBeUndefined();
  });

  it('trata valores sentinela como campo ausente', () => {
    const parsed = generateImageInputSchema.parse({
      ...requiredInput,
      referenceImageUrl: 'none',
    });

    expect(parsed.referenceImageUrl).toBeUndefined();
  });

  it('aceita URL e booleano dentro de objetos simples', () => {
    const parsed = generateImageInputSchema.parse({
      ...requiredInput,
      mode: 'I2I',
      referenceImageUrl: { url: 'https://example.com/reference.png' },
      style: { name: 'Editorial' },
      manualPrompt: { value: true },
    });

    expect(parsed.referenceImageUrl).toBe('https://example.com/reference.png');
    expect(parsed.style).toBe('Editorial');
    expect(parsed.manualPrompt).toBe(true);
  });
});
