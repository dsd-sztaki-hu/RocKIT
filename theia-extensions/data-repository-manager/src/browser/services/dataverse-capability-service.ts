import { injectable } from 'inversify';

@injectable()
export class DataverseCapabilityService {

    public async supportsArpRoCrateZipUpload(baseUrl: string): Promise<boolean> {
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
}
