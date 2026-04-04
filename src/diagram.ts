import { readFile } from 'node:fs/promises';

import { Diagram, DiagramType, Variant } from './types.js';

const STORAGE_TYPES = {
  sequence: 'zenuml-content-sequence',
  graph: 'zenuml-content-graph',
} as const;

const SUPPORTED_TYPES = new Map<string, DiagramType>([
  ['sequence', DiagramType.Sequence],
  ['mermaid', DiagramType.Mermaid],
  ['plantuml', DiagramType.PlantUml],
  ['graph', DiagramType.Graph],
  ['openapi', DiagramType.OpenApi],
  ['open-api', DiagramType.OpenApi],
]);

export function normalizeDiagramType(value: string | undefined): DiagramType | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = SUPPORTED_TYPES.get(value.trim().toLowerCase());
  if (!normalized) {
    throw new Error(`Unsupported diagram type "${value}".`);
  }

  return normalized;
}

export function getAddonKey(variant: Variant, explicitAddonKey?: string): string {
  if (explicitAddonKey) {
    return explicitAddonKey;
  }

  return variant === 'lite'
    ? 'com.zenuml.confluence-addon-lite'
    : 'com.zenuml.confluence-addon';
}

export function getStorageTypeForDiagram(diagramType: DiagramType): string {
  return diagramType === DiagramType.Graph ? STORAGE_TYPES.graph : STORAGE_TYPES.sequence;
}

export function getCustomContentType(diagramType: DiagramType, variant: Variant, explicitAddonKey?: string): string {
  return `ac:${getAddonKey(variant, explicitAddonKey)}:${getStorageTypeForDiagram(diagramType)}`;
}

export function extractDiagramContent(diagram: Diagram): string {
  switch (diagram.diagramType) {
    case DiagramType.Sequence:
    case DiagramType.OpenApi:
      return diagram.code ?? '';
    case DiagramType.Mermaid:
      return diagram.mermaidCode ?? '';
    case DiagramType.PlantUml:
      return diagram.plantUmlCode ?? '';
    case DiagramType.Graph:
      return diagram.graphXml ?? '';
  }
}

export function applyDiagramContent(diagramType: DiagramType, content: string, seed: Partial<Diagram> = {}): Diagram {
  const next: Diagram = {
    title: seed.title ?? '',
    styles: seed.styles,
    metadata: seed.metadata,
    diagramType,
  };

  switch (diagramType) {
    case DiagramType.Sequence:
    case DiagramType.OpenApi:
      next.code = content;
      break;
    case DiagramType.Mermaid:
      next.mermaidCode = content;
      break;
    case DiagramType.PlantUml:
      next.plantUmlCode = content;
      break;
    case DiagramType.Graph:
      next.graphXml = content;
      break;
  }

  return next;
}

export async function readDiagramInput(filePath: string | undefined, readStdin: boolean): Promise<string> {
  if (filePath && readStdin) {
    throw new Error('Use either --file or --stdin, not both.');
  }

  if (filePath) {
    return readFile(filePath, 'utf8');
  }

  if (readStdin) {
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      process.stdin.on('error', reject);
    });
  }

  throw new Error('Missing diagram input. Provide --file <path> or --stdin.');
}

export function parseDiagramInput(input: string, diagramType: DiagramType, seed: Partial<Diagram> = {}): Diagram {
  const trimmed = input.trim();

  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Partial<Diagram>;
    const parsedType = parsed.diagramType ? normalizeDiagramType(String(parsed.diagramType)) : undefined;
    const effectiveType = parsedType ?? diagramType;

    return {
      ...parsed,
      ...applyDiagramContent(
        effectiveType,
        extractDiagramContent({
          diagramType: effectiveType,
          code: parsed.code,
          mermaidCode: parsed.mermaidCode,
          plantUmlCode: parsed.plantUmlCode,
          graphXml: parsed.graphXml,
          title: parsed.title,
          styles: parsed.styles,
          metadata: parsed.metadata,
        }),
        { ...seed, ...parsed },
      ),
      diagramType: effectiveType,
      title: parsed.title ?? seed.title ?? '',
    };
  }

  return applyDiagramContent(diagramType, input, seed);
}
