CREATE TABLE `global_inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`total_stock` integer DEFAULT 0 NOT NULL,
	`min_stock` integer DEFAULT 0 NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`global_item_id` text NOT NULL,
	`from_store_id` text NOT NULL,
	`to_store_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`allocated_at` integer NOT NULL,
	`fulfilled_at` integer,
	`notes` text,
	FOREIGN KEY (`global_item_id`) REFERENCES `global_inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_store_id`) REFERENCES `store`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_store_id`) REFERENCES `store`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_conversion_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`global_item_id` text NOT NULL,
	`portion_name` text NOT NULL,
	`quantity_per_portion` real NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`global_item_id`) REFERENCES `global_inventory_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_conversions` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`global_item_id` text NOT NULL,
	`bulk_quantity_used` integer NOT NULL,
	`portions_produced` integer NOT NULL,
	`converted_at` integer NOT NULL,
	`notes` text,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`global_item_id`) REFERENCES `global_inventory_items`(`id`) ON UPDATE no action ON DELETE no action
);
