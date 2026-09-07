#!/usr/bin/env node
import { main } from './controller-lifecycle.mjs'
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
