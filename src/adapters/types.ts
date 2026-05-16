export interface ContentItem {
  id: string;
  title: string;
  url: string;
  source: string;
  timestamp: Date;
  body?: string;
}

export interface AdapterConfig {
  type: string;
  params?: Record<string, unknown>;
  refresh_interval?: number;
}

export interface Adapter {
  name: string;
  fetch(config: AdapterConfig): Promise<ContentItem[]>;
}
