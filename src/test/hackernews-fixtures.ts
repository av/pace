export interface HNItemFixture {
  id: number;
  title?: string;
  url?: string;
  score?: number;
  time?: number;
  by?: string;
  descendants?: number;
}

export function makeHNItem(id: number, overrides: Partial<HNItemFixture> = {}): HNItemFixture {
  return {
    id,
    title: `Story ${id}`,
    url: `https://example.com/story-${id}`,
    score: 100 + id,
    time: 1716200000 + id,
    by: "testuser",
    descendants: 5,
    ...overrides,
  };
}