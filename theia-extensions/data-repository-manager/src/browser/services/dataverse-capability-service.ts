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
        if (await this.supportsZenodoApi(baseUrl, apiKey)) {
            return {
                kind: 'zenodo',
                supportsArpRoCrateZipUpload: false,
                supportsNativeDataverseApi: false,
                supportsZenodoApi: true
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

    protected async supportsZenodoApi(baseUrl: string, apiKey?: string): Promise<boolean> {
        const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '').replace(/\/api$/, '');
        if (!normalizedBaseUrl) {
            return false;
        }

        try {
            const host = new URL(normalizedBaseUrl).hostname.toLowerCase();
            if (host === 'zenodo.org' || host === 'sandbox.zenodo.org') {
                return true;
            }
        } catch {
            return false;
        }

        try {
            const headers: Record<string, string> = { accept: 'application/json' };
            if (apiKey) {
                headers.authorization = `Bearer ${apiKey}`;
            }
            const response = await fetch(`${normalizedBaseUrl}/api/deposit/depositions`, {
                headers
            });
            const contentType = response.headers.get('content-type') ?? '';
            if (!contentType.toLowerCase().includes('application/json')) {
                return false;
            }
            if (response.ok) {
                return true;
            }
            return response.status === 401 || response.status === 403;
        } catch (error) {
            console.warn('Failed to detect Zenodo API capability:', error);
            return false;
        }
    }
}
