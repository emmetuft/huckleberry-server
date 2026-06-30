CREATE TABLE `domo_oauth_clients` (
	`issuer_url` varchar(255) NOT NULL,
	`client_id` varchar(200) NOT NULL,
	`registration_access_token` varchar(2000),
	`redirect_uri` varchar(500) NOT NULL,
	`scope` varchar(1000) NOT NULL,
	`registered_at` datetime(3) NOT NULL,
	`last_used_at` datetime(3),
	CONSTRAINT `domo_oauth_clients_issuer_url` PRIMARY KEY(`issuer_url`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `status` enum('pending_provision','pending_link','active','suspended') NOT NULL;