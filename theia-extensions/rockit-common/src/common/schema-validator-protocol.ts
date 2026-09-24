// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

export const SchemaValidatorManager = Symbol('SchemaValidatorManager')

export type ValidationError = {
  path: string;
  entityId: string;
  entityType: string;
  fieldName: string;
  fieldLabel: string;
  error: string;
  error_hu: string;
  errorCode: string;
};

export interface SchemaValidator {
  validateEntities(
    crate: Record<string, any>,
    baseProfile: Record<string, any>,
  ): Promise<ValidationError[] | undefined>;
  validate(entity: Record<string, any>, profile: Record<string, any>): ValidationError[];
}

