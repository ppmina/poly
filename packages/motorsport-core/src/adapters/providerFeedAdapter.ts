import { getSeriesCatalog, getSeriesDefinition, getSessionDefinition } from "../catalog";
import type { FeedAdapter, FeedStreamOptions, SeriesDefinition, SeriesId } from "../types";

class ProviderFeedAdapter implements FeedAdapter {
  public listSeries(): readonly SeriesDefinition[] {
    return getSeriesCatalog();
  }

  public listSessions(seriesId: SeriesId) {
    return getSeriesDefinition(seriesId)?.sessions ?? [];
  }

  public getSeries(seriesId: SeriesId) {
    return getSeriesDefinition(seriesId);
  }

  public getSession(seriesId: SeriesId, sessionId: string) {
    return getSessionDefinition(seriesId, sessionId);
  }

  public async *streamSession(_options: FeedStreamOptions) {
    yield* [];
    throw new Error("Provider feed mode is not configured yet.");
  }
}

export function createProviderFeedAdapter(): FeedAdapter {
  return new ProviderFeedAdapter();
}
