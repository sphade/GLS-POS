CREATE TABLE `inventory_production_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`input_product_id` text NOT NULL,
	`output_product_id` text NOT NULL,
	`input_qty` integer NOT NULL,
	`output_qty` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inventory_production_rules_store_idx` ON `inventory_production_rules` (`store_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_production_rules_pair_idx` ON `inventory_production_rules` (`store_id`,`input_product_id`,`output_product_id`);