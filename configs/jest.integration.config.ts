// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { Config } from '@jest/types'

export default async (): Promise<Config.InitialOptions> => ({
  preset: 'ts-jest',
  rootDir: '../',
  testMatch: ['<rootDir>/test/integration/**/*.integration.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { esModuleInterop: true } }],
  },
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/configs/jest.integration.setup.js'],
  moduleNameMapper: {
    '^vscode-languageserver-types': require.resolve('vscode-languageserver-types'),
    '^msgpackr': require.resolve('msgpackr'),
  },
})
