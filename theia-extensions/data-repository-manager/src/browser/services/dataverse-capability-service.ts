import { injectable } from 'inversify';
import { DataRepositoryCapabilities } from '../types';

@injectable()
export class DataverseCapabilityService {

    public async detectRepositoryCapabilities(baseUrl: string): Promise<DataRepositoryCapabilities> {
        const supportsArpRoCrateZipUpload = await this.supportsArpRoCrateZipUpload(baseUrl);
        if (supportsArpRoCrateZipUpload) {
            return {
                kind: 'arp-dataverse',
                supportsArpRoCrateZipUpload: true,
                supportsNativeDataverseApi: true
            };
        }
        if (await this.supportsNativeDataverseApi(baseUrl)) {
            return {
                kind: 'dataverse',
                supportsArpRoCrateZipUpload: false,
                supportsNativeDataverseApi: true
            };
        }
        return {
            kind: 'unknown',
            supportsArpRoCrateZipUpload: false,
            supportsNativeDataverseApi: false
        };
    }

    protected async supportsArpRoCrateZipUpload(baseUrl: string): Promise<boolean> {
        const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
        if (!normalizedBaseUrl) {
            return false;
        }

        try {
            const response = await fetch(`${normalizedBaseUrl}/api/arp/uploadRoCrateZip`, {
                method: 'OPTIONS'
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

    protected async supportsNativeDataverseApi(baseUrl: string): Promise<boolean> {
        const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
        if (!normalizedBaseUrl) {
            return false;
        }
        try {
            const response = await fetch(`${normalizedBaseUrl}/api/v1/dataverses/:root`, {
                headers: { accept: 'application/json' }
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
