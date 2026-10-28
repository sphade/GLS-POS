ALTER TABLE `inventory_conversion_rates` ADD `product_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_conversion_rates_target_idx` ON `inventory_conversion_rates` (`store_id`,`global_item_id`,`product_id`);--> statement-breakpoint
ALTER TABLE `inventory_conversions` ADD `product_id` text;