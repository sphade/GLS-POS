-- One row per (device, store) instead of one row per device.
--
-- A phone that works in two branches used to overwrite its token when it
-- switched shops, so it only ever heard alerts from the branch it was last on.
-- The composite key lets the same device hold a row per branch.
--
-- D1 always enforces foreign keys and cannot turn them off inside a migration
-- transaction, so the PRAGMA pair drizzle-kit emits is removed here. Nothing
-- references push_token, so the drop/rename is safe either way.
CREATE TABLE `__new_push_token` (
	`token` text NOT NULL,
	`user_id` text NOT NULL,
	`store_id` text NOT NULL,
	`platform` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`token`, `store_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_push_token`("token", "user_id", "store_id", "platform", "created_at") SELECT "token", "user_id", "store_id", "platform", "created_at" FROM `push_token`;
--> statement-breakpoint
DROP TABLE `push_token`;
--> statement-breakpoint
ALTER TABLE `__new_push_token` RENAME TO `push_token`;
--> statement-breakpoint
CREATE INDEX `push_token_user_idx` ON `push_token` (`user_id`,`store_id`);
