#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, watch } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function waitForTraining(root = '/workspace/.self-evolve', timeoutMs = 7200000, feedbackRoot = '/training-feedback') {
  const generation = JSON.parse(readFileSync(join(root, 'generation.json'), 'utf8'))
  const directory = feedbackRoot
  const path = join(directory, 'feedback.json')
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
  return new Promise((resolvePromise, reject) => {
    const finish = (error, value) => {
      clearTimeout(timer)
      watcher.close()
      error ? reject(error) : resolvePromise(value)
    }
    const check = () => {
      try {
        if (!existsSync(path)) return
        const value = JSON.parse(readFileSync(path, 'utf8'))
        if (value.generation !== generation.id || value.sourceCommit !== generation.sourceCommit) return
        if (value.status === 'completed') finish(undefined, value)
        else if (value.status === 'failed') finish(new Error('Training infrastructure failed; inspect the exported feedback and request host recovery'))
      } catch (error) { finish(error) }
    }
    // Subscribe before checking to avoid losing an atomic rename between read and watch.
    const watcher = watch(directory, check)
    watcher.once('error', error => finish(error))
    const timer = setTimeout(() => finish(new Error('Training feedback timeout; host curriculum may need recovery')), timeoutMs)
    check()
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  waitForTraining(process.env.SELF_EVOLVE_ROOT).then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}
