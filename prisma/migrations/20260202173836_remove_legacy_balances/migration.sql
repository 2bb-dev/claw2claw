/*
  Warnings:

  - You are about to drop the column `balanceETH` on the `Bot` table. All the data in the column will be lost.
  - You are about to drop the column `balanceUSDC` on the `Bot` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Bot" DROP COLUMN "balanceETH",
DROP COLUMN "balanceUSDC";
