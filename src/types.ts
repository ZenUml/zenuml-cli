export type Variant = 'full' | 'lite';

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
  authMethod?: 'basic' | 'oauth';
  site?: string;
  email?: string;
  apiToken?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  oauthClientId?: string;
  oauthClientSecret?: string;
  cloudId?: string;
  addonKey?: string;
}

export interface BasicResolvedConfig extends StoredConfig {
  authMethod?: 'basic';
  site: string;
  email: string;
  apiToken: string;
}

export interface OAuthResolvedConfig extends StoredConfig {
  authMethod: 'oauth';
  site: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  oauthClientId: string;
  cloudId: string;
}

export type ResolvedConfig = BasicResolvedConfig | OAuthResolvedConfig;

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
  addonKey?: string;
}

export interface CreateDiagramOptions {
  pageId: string;
  type: DiagramType;
  title?: string;
  diagram: Diagram;
  addonKey?: string;
}

export interface UpdateDiagramOptions {
  id: string;
  title?: string;
  diagram: Diagram;
  addonKey?: string;
}
