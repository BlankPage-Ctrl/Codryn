DROP INDEX "client_client_id_unique";--> statement-breakpoint
DROP INDEX "message_parts_message_id_idx";--> statement-breakpoint
DROP INDEX "message_parts_message_id_position_idx";--> statement-breakpoint
DROP INDEX "messages_chat_id_idx";--> statement-breakpoint
DROP INDEX "messages_chat_id_position_idx";--> statement-breakpoint
CREATE TABLE `__new_hitl_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`correlation_id` text,
	`workspace_id` text,
	`chat_id` text NOT NULL,
	`execution_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`response` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text,
	`resolved_at` text
);--> statement-breakpoint
INSERT INTO `__new_hitl_requests` (`id`, `type`, `title`, `description`, `correlation_id`, `workspace_id`, `chat_id`, `execution_id`, `metadata`, `payload`, `status`, `response`, `created_at`, `updated_at`, `expires_at`, `resolved_at`) SELECT `id`, `type`, `title`, `description`, `correlation_id`, `workspace_id`, `chat_id`, `execution_id`, `metadata`, `payload`, `status`, `response`, `created_at`, `updated_at`, `expires_at`, `resolved_at` FROM `hitl_requests`;--> statement-breakpoint
DROP TABLE `hitl_requests`;--> statement-breakpoint
ALTER TABLE `__new_hitl_requests` RENAME TO `hitl_requests`;--> statement-breakpoint
CREATE UNIQUE INDEX `client_client_id_unique` ON `client` (`client_id`);--> statement-breakpoint
CREATE INDEX `message_parts_message_id_idx` ON `message_parts` (`message_id`);--> statement-breakpoint
CREATE INDEX `message_parts_message_id_position_idx` ON `message_parts` (`message_id`,`position`);--> statement-breakpoint
CREATE INDEX `messages_chat_id_idx` ON `messages` (`chat_id`);--> statement-breakpoint
CREATE INDEX `messages_chat_id_position_idx` ON `messages` (`chat_id`,`position`);
