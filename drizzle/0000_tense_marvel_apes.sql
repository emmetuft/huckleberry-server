CREATE TABLE `magic_links` (
	`token_hash` varchar(64) NOT NULL,
	`user_id` binary(16) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`consumed_at` datetime(3),
	`ip_issued_from` varchar(45),
	CONSTRAINT `magic_links_token_hash` PRIMARY KEY(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`sid` varchar(64) NOT NULL,
	`user_id` binary(16) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`csrf_token` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	CONSTRAINT `sessions_sid` PRIMARY KEY(`sid`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` binary(16) NOT NULL,
	`email` varchar(255) NOT NULL,
	`email_verified` tinyint NOT NULL DEFAULT 0,
	`display_name` varchar(255),
	`status` enum('pending_link','active','suspended') NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`last_login_at` datetime(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE INDEX `magic_links_user_id_idx` ON `magic_links` (`user_id`);--> statement-breakpoint
CREATE INDEX `magic_links_expires_at_idx` ON `magic_links` (`expires_at`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);