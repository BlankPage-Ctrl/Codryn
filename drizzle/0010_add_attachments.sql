CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`original_filename` text NOT NULL,
	`stored_filename` text NOT NULL,
	`media_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text
);
--> statement-breakpoint
CREATE INDEX `attachments_workspace_id_idx` ON `attachments` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `attachments_status_expires_idx` ON `attachments` (`status`,`expires_at`);
