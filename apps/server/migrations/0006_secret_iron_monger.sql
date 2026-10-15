ALTER TABLE `inventory_allocations` ADD `product_id` text;--> statement-breakpoint
ALTER TABLE `inventory_allocations` ADD `allocated_by_user_id` text;--> statement-breakpoint
ALTER TABLE `inventory_allocations` ADD `allocated_by_name` text;--> statement-breakpoint
ALTER TABLE `inventory_allocations` ADD `fulfilled_by_user_id` text;--> statement-breakpoint
ALTER TABLE `inventory_allocations` ADD `fulfilled_by_name` text;