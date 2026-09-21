#!/usr/bin/env node
console.error("Weavra publication is unavailable: no independent release infrastructure is configured. Build and inspect local artifacts instead; this command does not publish, announce, tag, push, or modify the checkout.");
process.exitCode = 1;
