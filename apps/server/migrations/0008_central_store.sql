ALTER TABLE `store` ADD `is_central` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `store` ADD `parent_store_id` text;--> statement-breakpoint
ALTER TABLE `global_inventory_items` ADD `owner_id` text;--> statement-breakpoint
ALTER TABLE `global_inventory_items` ADD `store_id` text;--> statement-breakpoint
ALTER TABLE `inventory_allocations` ADD `stock_deducted_at` integer;--> statement-breakpoint

-- One central store per existing owner. Existing shops become its children.
INSERT INTO `store` (`id`, `name`, `currency`, `owner_id`, `is_central`, `parent_store_id`, `created_at`, `updated_at`)
SELECT 'store_central_' || s.`owner_id`, 'Central Store', s.`currency`, s.`owner_id`, 1, NULL,
       CAST(strftime('%s', 'now') AS INTEGER), CAST(strftime('%s', 'now') AS INTEGER)
FROM `store` s
WHERE s.`is_central` = 0
  AND NOT EXISTS (
    SELECT 1 FROM `store` c
    WHERE c.`owner_id` = s.`owner_id` AND c.`is_central` = 1
  )
GROUP BY s.`owner_id`;--> statement-breakpoint

INSERT INTO `member` (`id`, `user_id`, `store_id`, `role`, `created_at`)
SELECT 'mbr_central_' || c.`owner_id`, c.`owner_id`, c.`id`, 'owner',
       CAST(strftime('%s', 'now') AS INTEGER)
FROM `store` c
WHERE c.`is_central` = 1
  AND NOT EXISTS (
    SELECT 1 FROM `member` m
    WHERE m.`user_id` = c.`owner_id` AND m.`store_id` = c.`id`
  );--> statement-breakpoint

UPDATE `store`
SET `parent_store_id` = (
  SELECT c.`id` FROM `store` c
  WHERE c.`owner_id` = `store`.`owner_id` AND c.`is_central` = 1
  LIMIT 1
)
WHERE `is_central` = 0 AND `parent_store_id` IS NULL;--> statement-breakpoint

-- Old items had no owner. Infer it from the shop that sent the item, so two
-- owners' stock can never be merged into one central store.
UPDATE `global_inventory_items`
SET `owner_id` = (
      SELECT s.`owner_id`
      FROM `inventory_allocations` a
      JOIN `store` s ON s.`id` = a.`from_store_id`
      WHERE a.`global_item_id` = `global_inventory_items`.`id`
      ORDER BY a.`allocated_at` DESC
      LIMIT 1
    ),
    `store_id` = (
      SELECT c.`id`
      FROM `inventory_allocations` a
      JOIN `store` s ON s.`id` = a.`from_store_id`
      JOIN `store` c ON c.`owner_id` = s.`owner_id` AND c.`is_central` = 1
      WHERE a.`global_item_id` = `global_inventory_items`.`id`
      ORDER BY a.`allocated_at` DESC
      LIMIT 1
    )
WHERE `owner_id` IS NULL
  AND EXISTS (
    SELECT 1 FROM `inventory_allocations` a
    WHERE a.`global_item_id` = `global_inventory_items`.`id`
  );--> statement-breakpoint

-- Only a single-owner deployment can safely claim items that were never sent
-- anywhere. With multiple owners, leave them unclaimed rather than leak them.
UPDATE `global_inventory_items`
SET `owner_id` = (SELECT `owner_id` FROM `store` WHERE `is_central` = 1 ORDER BY `created_at`, `id` LIMIT 1),
    `store_id` = (SELECT `id` FROM `store` WHERE `is_central` = 1 ORDER BY `created_at`, `id` LIMIT 1)
WHERE `owner_id` IS NULL
  AND (SELECT COUNT(DISTINCT `owner_id`) FROM `store`) = 1;--> statement-breakpoint

CREATE INDEX `store_owner_central_idx` ON `store` (`owner_id`, `is_central`);--> statement-breakpoint
CREATE INDEX `global_inventory_items_store_idx` ON `global_inventory_items` (`store_id`);--> statement-breakpoint
CREATE INDEX `inventory_allocations_from_store_idx` ON `inventory_allocations` (`from_store_id`);
