import { injectable } from 'inversify';
import { 
    ApiConfig, 
    getCollectionItems,
    getCollectionUserPermissions,
    CollectionItemType,
    CollectionSearchCriteria
} from '@iqss/dataverse-client-javascript';
import { DataverseApiAuthMechanism } from '@iqss/dataverse-client-javascript/dist/core/infra/repositories/ApiConfig';

@injectable()
export class DataverseCollectionService {

    /**
     * Initializes the Dataverse API client with the provided credentials.
     */
    public initClient(baseUrl: string, apiKey: string): void {
        const normalizedUrl = baseUrl.endsWith('/api/v1') ? baseUrl : `${baseUrl.replace(/\/+$/, '')}/api/v1`;
        ApiConfig.init(normalizedUrl, DataverseApiAuthMechanism.API_KEY, apiKey);
    }

    /**
     * Fetches collection children under a specific collection alias.
     * If no alias is provided, Dataverse returns items from the root collection.
     */
    public async getChildCollections(collectionAlias?: string) {
        try {
            const items: any[] = [];
            const limit = 100;
            let offset = 0;
            let total = Number.POSITIVE_INFINITY;
            const criteria = new CollectionSearchCriteria(
                undefined,
                [CollectionItemType.COLLECTION],
            );

            while (offset < total) {
                const result = await getCollectionItems.execute(
                    collectionAlias,
                    limit,
                    offset,
                    criteria,
                );
                const pageItems = result.items || [];
                items.push(...pageItems);
                total = typeof result.totalItemCount === 'number'
                    ? result.totalItemCount
                    : items.length;
                if (pageItems.length === 0) {
                    break;
                }
                offset += pageItems.length;
            }

            return items.filter((item: any) => item?.type === CollectionItemType.COLLECTION);
        } catch (error) {
            console.error(`Error fetching child collections for ${collectionAlias ?? ':root'}:`, error);
            throw error;
        }
    }

    /**
     * Checks if the user has permission to add a dataset to a specific collection.
     */
    public async canAddDataset(collectionId: string): Promise<boolean> {
        try {
            const permissions = await getCollectionUserPermissions.execute(collectionId);
            return permissions.canAddDataset;
        } catch (error) {
            console.error(`Error checking permissions for collection ${collectionId}:`, error);
            return false;
        }
    }
}
