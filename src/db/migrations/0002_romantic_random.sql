-- Remove duplicate 'did' values, keeping the first occurrence
DELETE FROM `users`
WHERE `id` NOT IN (
    SELECT MIN(`id`)
    FROM `users`
    GROUP BY `did`
);

-- Remove duplicate 'phone_number' values, keeping the first occurrence
DELETE FROM `users`
WHERE `id` NOT IN (
    SELECT MIN(`id`)
    FROM `users`
    GROUP BY `phone_number`
);

-- Create unique indexes
CREATE UNIQUE INDEX `users_did_unique` ON `users` (`did`);
CREATE UNIQUE INDEX `users_phone_number_unique` ON `users` (`phone_number`);