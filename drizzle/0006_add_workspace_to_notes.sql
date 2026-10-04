-- Workspace scope for notes & categories (breaking change: adds workspace_id)
-- Existing rows get DEFAULT '' so ALTER succeeds; run scripts/migrate-notes-workspace.ts to backfill real workspace
ALTER TABLE `categories` ADD `workspace_id` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE INDEX `categories_workspace_id_idx` ON `categories` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `notes` ADD `workspace_id` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE INDEX `notes_workspace_id_idx` ON `notes` (`workspace_id`);