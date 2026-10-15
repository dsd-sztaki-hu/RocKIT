// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { injectable } from 'inversify';
import { DataRepositoryCapabilities } from '../types';

@injectable()
export class DataverseCapabilityService {

    public async detectRepositoryCapabilities(baseUrl: string, apiKey?: string): Promise<DataRepositoryCapabilities> {
        const supportsArpRoCrateZipUpload = await this.supportsArpRoCrateZipUpload(baseUrl, apiKey);
        if (supportsArpRoCrateZipUpload) {
            return {
                kind: 'arp-dataverse',
                supportsArpRoCrateZipUpload: true,
                supportsNativeDataverseApi: true,
                supportsZenodoApi: false
            };
        }
        if (await this.supportsNativeDataverseApi(baseUrl, apiKey)) {
            return {
                kind: 'dataverse',
                supportsArpRoCrateZipUpload: false,
                supportsNativeDataverseApi: true,
                supportsZenodoApi: false
            };
        }
        return {
            kind: 'unknown',
            supportsArpRoCrateZipUpload: false,
            supportsNativeDataverseApi: false,
            supportsZenodoApi: false
        };
    }

    protected async supportsArpRoCrateZipUpload(baseUrl: string, apiKey?: string): Promise<boolean> {
        const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
        if (!normalizedBaseUrl) {
            return false;
        }

        try {
            const headers: Record<string, string> = {};
            if (apiKey) {
                headers['x-dataverse-key'] = apiKey;
            }
            const response = await fetch(`${normalizedBaseUrl}/api/arp/uploadRoCrateZip`, {
                method: 'OPTIONS',
                headers
            });
            if (!response.ok) {
                return false;
            }

            const allow = response.headers.get('allow');
            return !allow || allow
                .split(',')
                .map(method => method.trim().toUpperCase())
                .includes('POST');
        } catch (error) {
            console.warn('Failed to detect ARP RO-Crate ZIP upload capability:', error);
            return false;
        }
    }

    protected async supportsNativeDataverseApi(baseUrl: string, apiKey?: string): Promise<boolean> {
        const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
        if (!normalizedBaseUrl) {
            return false;
        }
        try {
            const headers: Record<string, string> = { accept: 'application/json' };
            if (apiKey) {
                headers['x-dataverse-key'] = apiKey;
            }
            const response = await fetch(`${normalizedBaseUrl}/api/dataverses/root`, {
                headers
            });
            if (!response.ok) {
                return false;
            }
            const payload = await response.json() as {
                status?: unknown;
                data?: {
                    id?: unknown;
                    alias?: unknown;
                };
            };
            return payload.status === 'OK'
                && typeof payload.data?.id === 'number'
                && payload.data.alias === 'root';
        } catch (error) {
            console.warn('Failed to detect native Dataverse API capability:', error);
            return false;
        }
    }

}
