// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { defineConfig } from '@playwright/test'

const isCI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e/tests',
  testMatch: '**/*.e2e.spec.ts',
  outputDir: 'test-results/e2e/electron',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 90_000,
  globalTimeout: isCI ? 15 * 60_000 : undefined,
  expect: {
    timeout: 15_000,
  },
  preserveOutput: 'failures-only',
  reporter: isCI
    ? [
        ['list'],
        ['github'],
        ['html', { outputFolder: 'playwright-report/electron', open: 'never' }],
      ]
    : [['list'], ['html', { outputFolder: 'playwright-report/electron', open: 'never' }]],
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'electron',
    },
  ],
})
