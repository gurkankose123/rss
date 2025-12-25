
export interface GroundingSource {
  title: string;
  uri: string;
}

export interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  author: string;
  platform?: string;
  imageUrl?: string;
  sources?: GroundingSource[];
}

export interface RSSFeed {
  title: string;
  description: string;
  link: string;
  lastBuildDate: string;
  items: RSSItem[];
}

export interface MonitoredProfile {
  id: string;
  url: string;
  name: string;
  platform: string;
  lastChecked: string | null;
  status: 'idle' | 'scanning' | 'error' | 'success';
  items: RSSItem[];
}
