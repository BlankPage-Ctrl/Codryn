CREATE TABLE `message_run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`run_id` text(64) NOT NULL,
	`step_index` integer NOT NULL,
	`finish_reason` text(32),
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`model_id` text(255),
	`provider_metadata_json` text,
	`tool_calls_json` text,
	`started_at_ms` integer,
	`finished_at_ms` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_run_steps_message_id_idx` ON `message_run_steps` (`message_id`);--> statement-breakpoint
CREATE INDEX `message_run_steps_run_id_idx` ON `message_run_steps` (`run_id`);--> statement-breakpoint
CREATE INDEX `message_run_steps_chat_id_idx` ON `message_run_steps` (`chat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_run_steps_message_step_uq` ON `message_run_steps` (`message_id`,`step_index`);