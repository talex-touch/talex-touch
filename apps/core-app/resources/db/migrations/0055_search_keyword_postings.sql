ALTER TABLE `search_index_meta` ADD `doc_id` integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `search_keyword_postings` (
  `provider_id` text NOT NULL,
  `keyword` text NOT NULL,
  `doc_id` integer NOT NULL,
  `priority` real DEFAULT 1 NOT NULL,
  PRIMARY KEY(`provider_id`, `keyword`, `doc_id`)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_search_keyword_postings_doc` ON `search_keyword_postings` (`doc_id`, `priority`);
--> statement-breakpoint
-- Built here, on the main thread, although it reads every meta row: an index too full for it
-- fails setup, which rebuilds the index. Left to the writer, the same failure would stop every
-- write, the deletes that could free a page included.
CREATE UNIQUE INDEX IF NOT EXISTS `idx_search_index_meta_doc_id` ON `search_index_meta` (`doc_id`) WHERE `doc_id` IS NOT NULL;
