CREATE TABLE `mcp_servers` (
	`id` binary(16) NOT NULL,
	`customer_id` varchar(64) NOT NULL,
	`user_id` binary(16) NOT NULL,
	`name` varchar(255) NOT NULL,
	`url` varchar(2000) NOT NULL,
	`enabled` tinyint NOT NULL DEFAULT 1,
	`auth_type` varchar(20) NOT NULL DEFAULT 'none',
	`bearer_token` varchar(2000),
	`oauth2_config` text,
	`tools` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `mcp_servers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `personas` (
	`id` binary(16) NOT NULL,
	`customer_id` varchar(64) NOT NULL,
	`user_id` binary(16) NOT NULL,
	`name` varchar(255) NOT NULL,
	`role` varchar(255) NOT NULL DEFAULT '',
	`level` varchar(50) NOT NULL DEFAULT '',
	`department` varchar(255) NOT NULL DEFAULT '',
	`team` varchar(255),
	`focus_areas` varchar(2000) NOT NULL DEFAULT '[]',
	`strengths` varchar(2000) NOT NULL DEFAULT '[]',
	`weaknesses` varchar(2000) NOT NULL DEFAULT '[]',
	`goals` varchar(2000) NOT NULL DEFAULT '',
	`is_default` tinyint NOT NULL DEFAULT 0,
	`use_persona` tinyint NOT NULL DEFAULT 1,
	`use_activity` tinyint NOT NULL DEFAULT 1,
	`use_data` tinyint NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `personas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `mcp_servers_tenant_idx` ON `mcp_servers` (`customer_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `personas_tenant_idx` ON `personas` (`customer_id`,`user_id`);