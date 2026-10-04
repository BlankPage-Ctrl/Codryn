CREATE TABLE `fm_file_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`run_id` text(64),
	`tool_call_id` text(128),
	`path` text NOT NULL,
	`op` text(16) NOT NULL,
	`existed_before` integer NOT NULL,
	`before_hash` text(64),
	`after_hash` text(64) NOT NULL,
	`before_blob` text,
	`snapshot_truncated` integer DEFAULT 0 NOT NULL,
	`diff_preview` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `fm_file_history_chat_id_idx` ON `fm_file_history` (`chat_id`);--> statement-breakpoint
CREATE INDEX `fm_file_history_message_id_idx` ON `fm_file_history` (`message_id`);--> statement-breakpoint
CREATE INDEX `fm_file_history_workspace_path_idx` ON `fm_file_history` (`workspace_id`,`path`);