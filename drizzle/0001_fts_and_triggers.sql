-- Custom migration: FTS5 search tables (kept in sync by triggers) and the audit-log immutability trigger.
-- App code never writes to *_fts tables directly. Never run `drizzle-kit push` (it would drop these).
CREATE VIRTUAL TABLE `cards_fts` USING fts5(card_id UNINDEXED, title, body, tags, tokenize='porter unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `cards_fts_ai` AFTER INSERT ON `knowledge_cards` BEGIN
  INSERT INTO cards_fts(card_id, title, body, tags) VALUES (new.id, new.title, new.search_text, new.search_tags);
END;
--> statement-breakpoint
CREATE TRIGGER `cards_fts_ad` AFTER DELETE ON `knowledge_cards` BEGIN
  DELETE FROM cards_fts WHERE card_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER `cards_fts_au` AFTER UPDATE OF title, search_text, search_tags ON `knowledge_cards` BEGIN
  DELETE FROM cards_fts WHERE card_id = old.id;
  INSERT INTO cards_fts(card_id, title, body, tags) VALUES (new.id, new.title, new.search_text, new.search_tags);
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE `quotes_fts` USING fts5(quote_id UNINDEXED, title, body, tags, tokenize='porter unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `quotes_fts_ai` AFTER INSERT ON `quotes` BEGIN
  INSERT INTO quotes_fts(quote_id, title, body, tags) VALUES (new.id, new.search_title, new.search_text, new.search_tags);
END;
--> statement-breakpoint
CREATE TRIGGER `quotes_fts_ad` AFTER DELETE ON `quotes` BEGIN
  DELETE FROM quotes_fts WHERE quote_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER `quotes_fts_au` AFTER UPDATE OF search_title, search_text, search_tags ON `quotes` BEGIN
  DELETE FROM quotes_fts WHERE quote_id = old.id;
  INSERT INTO quotes_fts(quote_id, title, body, tags) VALUES (new.id, new.search_title, new.search_text, new.search_tags);
END;
--> statement-breakpoint
-- Audit rows are written once (pending) and finalized once; after completion they can't be edited.
CREATE TRIGGER `ai_audit_log_immutable` BEFORE UPDATE ON `ai_audit_log` WHEN old.completed_at IS NOT NULL BEGIN
  SELECT RAISE(ABORT, 'ai_audit_log rows are immutable once completed');
END;
