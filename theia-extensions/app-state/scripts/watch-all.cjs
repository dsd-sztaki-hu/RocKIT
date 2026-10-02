#!/usr/bin/env node

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************
const { spawn } = require('node:child_process')
const path = require('node:path')

const gen = spawn('node', [path.join(__dirname, 'generate-accessors.cjs'), '--watch'], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
})

const tsc = spawn('tsc', ['-w'], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
})

function shutdown(code) {
  gen.kill('SIGINT')
  tsc.kill('SIGINT')
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
