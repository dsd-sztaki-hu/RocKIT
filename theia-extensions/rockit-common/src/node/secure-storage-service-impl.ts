// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { injectable } from 'inversify';
import * as keytar from 'keytar';
import { SecureStorageService } from '../common/secure-storage-protocol';

@injectable()
export class SecureStorageServiceImpl implements SecureStorageService {
    
    async setPassword(service: string, account: string, password: string): Promise<void> {
        await keytar.setPassword(service, account, password);
    }

    async getPassword(service: string, account: string): Promise<string | null> {
        return await keytar.getPassword(service, account);
    }

    async deletePassword(service: string, account: string): Promise<boolean> {
        return await keytar.deletePassword(service, account);
    }

    async findCredentials(service: string): Promise<{ account: string; password: string }[]> {
        return await keytar.findCredentials(service);
    }
}