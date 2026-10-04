CREATE TABLE `hitl_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`correlation_id` text,
	`workspace_id` text,
	`chat_id` text NOT NULL,
	`execution_id` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`response` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text,
	`resolved_at` text
);
