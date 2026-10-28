CREATE TABLE `central_stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`store_id` text,
	`delta` integer NOT NULL,
	`base_stock` integer NOT NULL,
	`resulting` integer NOT NULL,
	`note` text,
	`actor_id` text,
	`actor_name` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `global_inventory_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `central_stock_movements_item_idx` ON `central_stock_movements` (`item_id`,`at`);