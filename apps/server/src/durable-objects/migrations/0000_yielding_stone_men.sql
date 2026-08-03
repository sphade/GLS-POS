CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`items` text NOT NULL,
	`payments` text NOT NULL,
	`currency` text NOT NULL,
	`subtotal` integer NOT NULL,
	`tax_total` integer NOT NULL,
	`discount_total` integer NOT NULL,
	`grand_total` integer NOT NULL,
	`customer_id` text,
	`staff_id` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`category_id` text,
	`name` text NOT NULL,
	`sku` text,
	`barcode` text,
	`price` integer NOT NULL,
	`cost` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`stock_quantity` integer,
	`tax_rate_bps` integer,
	`image_url` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
