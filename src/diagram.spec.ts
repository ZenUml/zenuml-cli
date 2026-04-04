import { describe, expect, it } from 'vitest';

import {
  applyDiagramContent,
  extractDiagramContent,
  getCustomContentType,
  normalizeDiagramType,
  parseDiagramInput,
} from './diagram.js';
import { DiagramType } from './types.js';

describe('diagram helpers', () => {
  it('normalizes supported aliases', () => {
    expect(normalizeDiagramType('openapi')).toBe(DiagramType.OpenApi);
    expect(normalizeDiagramType('Open-API')).toBe(DiagramType.OpenApi);
    expect(normalizeDiagramType('graph')).toBe(DiagramType.Graph);
  });

  it('maps content into the correct diagram field', () => {
    expect(applyDiagramContent(DiagramType.Mermaid, 'graph TD').mermaidCode).toBe('graph TD');
    expect(applyDiagramContent(DiagramType.Graph, '<mxGraph />').graphXml).toBe('<mxGraph />');
  });

  it('builds custom content types from variant and diagram type', () => {
    expect(getCustomContentType(DiagramType.Sequence, 'full')).toBe(
      'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
    );
    expect(getCustomContentType(DiagramType.Graph, 'lite')).toBe(
      'ac:com.zenuml.confluence-addon-lite:zenuml-content-graph',
    );
  });

  it('parses raw input into a type-aware diagram object', () => {
    const diagram = parseDiagramInput('sequence Alice->Bob: hi', DiagramType.Sequence, { title: 'Greeting' });
    expect(diagram.diagramType).toBe(DiagramType.Sequence);
    expect(diagram.title).toBe('Greeting');
    expect(diagram.code).toContain('Alice->Bob');
  });

  it('prefers explicit JSON payload fields when provided', () => {
    const diagram = parseDiagramInput(
      JSON.stringify({ diagramType: 'mermaid', title: 'Flow', mermaidCode: 'graph TD; A-->B;' }),
      DiagramType.Sequence,
    );

    expect(diagram.diagramType).toBe(DiagramType.Mermaid);
    expect(extractDiagramContent(diagram)).toContain('graph TD');
  });
});
