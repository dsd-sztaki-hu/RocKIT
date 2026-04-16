import { injectable } from 'inversify';
import { 
    ApiConfig, 
    getUserSelectableRoles, 
    getMyDataCollectionItems, 
    getCollectionUserPermissions,
    CollectionItemType,
    PublicationStatus
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
     * Fetches the roles that a user can have in a collection.
     */
    public async getSelectableRoles() {
        try {
            return await getUserSelectableRoles.execute();
        } catch (error) {
            console.error('Error fetching selectable roles:', error);
            throw error;
        }
    }

    /**
     * Fetches collections where the user has the specified roles.
     */
    public async getMyCollections(roleIds: string[]) {
        try {
            // Convert roleIds to number[] as required by the library
            const roleIdsAsNumbers = roleIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));

            // We want collections that are identifiable as collections, regardless of publication status
            const result = await getMyDataCollectionItems.execute(
                roleIdsAsNumbers,
                [CollectionItemType.COLLECTION],
                [
                    PublicationStatus.Published,
                    PublicationStatus.Unpublished,
                    PublicationStatus.Draft,
                    PublicationStatus.Deaccessioned,
                    PublicationStatus.InReview
                ],
                100, 0
            );

            // MyDataCollectionItemSubset has an 'items' property containing the previews
            return result.items || [];
        } catch (error) {
            console.error('Error fetching user collections:', error);
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
