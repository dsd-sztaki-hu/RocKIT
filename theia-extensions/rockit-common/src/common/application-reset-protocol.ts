// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

export const ApplicationResetService = Symbol('ApplicationResetService')
export const APPLICATION_RESET_PATH = '/services/application-reset'

export interface ApplicationResetResult {
  rockitRootPath: string
}

export interface ApplicationResetService {
  resetApplication(): Promise<ApplicationResetResult>
}
