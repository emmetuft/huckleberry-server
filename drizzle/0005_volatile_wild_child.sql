ALTER TABLE `domo_oauth_tokens` ADD `refresh_iv` varchar(64);--> statement-breakpoint
ALTER TABLE `domo_oauth_tokens` ADD `refresh_dek_id` varchar(500);