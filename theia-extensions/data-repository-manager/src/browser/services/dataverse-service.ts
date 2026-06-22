import { injectable } from 'inversify';
import { 
    ApiConfig, 
    getCurrentAuthenticatedUser, 
    getCurrentApiToken
} from '@iqss/dataverse-client-javascript';
import { DataverseApiAuthMechanism } from '@iqss/dataverse-client-javascript/dist/core/infra/repositories/ApiConfig';

@injectable()
export class DataverseService {

    /**
     * Re-initializes the global ApiConfig with specific credentials.
     * This is necessary because the library uses a global state for configuration.
     */
    protected initClient(baseUrl: string, apiKey: string): void {
        // Ensure the base URL ends with /api/v1 as expected by the library
        const normalizedUrl = baseUrl.endsWith('/api/v1') ? baseUrl : `${baseUrl.replace(/\/+$/, '')}/api/v1`;
        
        ApiConfig.init(
            normalizedUrl,
            DataverseApiAuthMechanism.API_KEY,
            apiKey
        );
    }

    /**
     * Validates an API token by attempting to fetch the current authenticated user.
     * Also attempts to retrieve the token's expiration date.
     */
    public async validateToken(baseUrl: string, apiKey: string): Promise<{ userName: string, expirationDate?: string }> {
        this.initClient(baseUrl, apiKey);

        try {
            // 1. Get User Info to verify token and get a display name
            const user = await getCurrentAuthenticatedUser.execute();
            
            // 2. Attempt to get token info for expiration date
            let expirationDate: string | undefined = undefined;
            try {
                const tokenInfo = await getCurrentApiToken.execute();
                if (tokenInfo.expirationDate) {
                    expirationDate = tokenInfo.expirationDate.toISOString();
                }
            } catch (tokenError) {
                console.warn('Could not retrieve token expiration date, but user is authenticated:', tokenError);
            }

            return {
                userName: user.displayName,
                expirationDate
            };
        } catch (error: any) {
            console.error('Dataverse validation failed:', error);
            throw error;
        }
    }
}
