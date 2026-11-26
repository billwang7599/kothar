#!/usr/bin/env node
// The kothar command (see commands.ts). Node runs this TypeScript as is (type stripping), like the core.
import { run } from './commands.ts'

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
})
