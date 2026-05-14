CREATE TABLE `domo_oauth_tokens` (
	`link_id` binary(16) NOT NULL,
	`refresh_token` varchar(2000) NOT NULL,
	`scope` varchar(1000) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `domo_oauth_tokens_link_id` PRIMARY KEY(`link_id`)
);
--> statement-breakpoint
CREATE TABLE `linked_domo_instances` (
	`id` binary(16) NOT NULL,
	`user_id` binary(16) NOT NULL,
	`issuer_url` varchar(255) NOT NULL,
	`customer_id` varchar(64) NOT NULL,
	`domo_sub` varchar(64),
	`scope` varchar(1000) NOT NULL,
	`linked_at` datetime(3) NOT NULL,
	`last_used_at` datetime(3),
	CONSTRAINT `linked_domo_instances_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `linked_domo_user_id_idx` ON `linked_domo_instances` (`user_id`);--> statement-breakpoint
CREATE INDEX `linked_domo_customer_id_idx` ON `linked_domo_instances` (`customer_id`);