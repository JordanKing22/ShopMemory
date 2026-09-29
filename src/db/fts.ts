/**
 * FTS5 maintenance. The *_fts tables are filled by triggers (drizzle/0001_fts_and_triggers.sql); app code never
 * writes to them except through rebuildFts(), which reset calls so the index always matches the base tables.
 */
import type Database from "better-sqlite3";

export function rebuildFts(sqlite: Database.Database): void {
  sqlite.exec(`
    DELETE FROM cards_fts;
    INSERT INTO cards_fts(card_id, title, body, tags) SELECT id, title, search_text, search_tags FROM knowledge_cards;
    INSERT INTO cards_fts(cards_fts) VALUES('optimize');
    DELETE FROM quotes_fts;
    INSERT INTO quotes_fts(quote_id, title, body, tags) SELECT id, search_title, search_text, search_tags FROM quotes;
    INSERT INTO quotes_fts(quotes_fts) VALUES('optimize');
  `);
}
