-- Run as MySQL root after installing MySQL Community 8 locally:
--   mysql -u root -p < scripts/setup-mysql-local.sql

CREATE DATABASE IF NOT EXISTS finsync360
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE DATABASE IF NOT EXISTS finsync360_test
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'finsync'@'localhost' IDENTIFIED BY 'finsyncpass';
CREATE USER IF NOT EXISTS 'finsync'@'127.0.0.1' IDENTIFIED BY 'finsyncpass';

GRANT ALL PRIVILEGES ON finsync360.* TO 'finsync'@'localhost';
GRANT ALL PRIVILEGES ON finsync360.* TO 'finsync'@'127.0.0.1';
GRANT ALL PRIVILEGES ON finsync360_test.* TO 'finsync'@'localhost';
GRANT ALL PRIVILEGES ON finsync360_test.* TO 'finsync'@'127.0.0.1';

FLUSH PRIVILEGES;
