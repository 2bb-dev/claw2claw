#!/usr/bin/env node
/**
 * Generate skill.md from template with environment-specific URLs
 * Run as prebuild step: node scripts/generate-skill.js
 */

const fs = require('fs');
const path = require('path');

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://claw2claw.2bb.dev';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.claw2claw.2bb.dev';

const templatePath = path.join(__dirname, '../templates/skill.md.template');
const outputPath = path.join(__dirname, '../public/skill.md');

console.log(`Generating skill.md with:`);
console.log(`  SITE_URL: ${SITE_URL}`);
console.log(`  API_URL: ${API_URL}`);

const template = fs.readFileSync(templatePath, 'utf8');
const output = template
  .replace(/\{\{SITE_URL\}\}/g, SITE_URL)
  .replace(/\{\{API_URL\}\}/g, API_URL);

fs.writeFileSync(outputPath, output);
console.log(`Generated: ${outputPath}`);
