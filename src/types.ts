export type Variant = 'full' | 'lite' | 'auto';

export type OutputFormat = 'json' | 'text';
export type ExportFormat = 'json' | 'raw';

export enum DiagramType {
  Sequence = 'sequence',
  Mermaid = 'mermaid',
  PlantUml = 'plantuml',
  Graph = 'graph',
  OpenApi = 'OpenAPI',
}

export interface Diagram {
  id?: string;
  diagramType: DiagramType;
  title?: string;
  code?: string;
  mermaidCode?: string;
  plantUmlCode?: string;
  graphXml?: string;
  styles?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface StoredConfig {
  site?: string;
  email?: string;
  apiToken?: string;
  variant?: Variant;
  addonKey?: string;
}

export interface ResolvedConfig extends StoredConfig {
  site: string;
  email: string;
  apiToken: string;
  variant: Variant;
}

export interface CustomContentVersion {
  number: number;
  createdAt?: string;
  authorId?: string;
}

export interface CustomContentBody {
  raw: {
    value: string;
  };
}

export interface CustomContentRecord {
  id: string;
  type: string;
  title: string;
  status: string;
  body: CustomContentBody;
  pageId?: string | number;
  spaceId?: string | number;
  createdAt?: string;
  authorId?: string;
  version?: CustomContentVersion;
}

export interface ParsedDiagramRecord extends CustomContentRecord {
  value: Diagram;
}

export interface ListDiagramOptions {
  space?: string;
  page?: string;
  type?: DiagramType;
  limit: number;
  variant?: Variant;
  addonKey?: string;
}

export interface CreateDiagramOptions {
  pageId: string;
  type: DiagramType;
  title?: string;
  diagram: Diagram;
  variant?: Variant;
  addonKey?: string;
}

export interface UpdateDiagramOptions {
  id: string;
  title?: string;
  diagram: Diagram;
  variant?: Variant;
  addonKey?: string;
}
