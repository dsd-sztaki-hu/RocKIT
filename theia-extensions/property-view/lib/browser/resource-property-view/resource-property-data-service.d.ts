import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { PropertyDataService } from '../property-data-service';
/**
 * This data service provides property data for {@link FileSelection}s and selections of {@link Navigatable}s.
 */
export declare class ResourcePropertyDataService implements PropertyDataService {
    readonly id = "resources";
    readonly label = "ResourcePropertyDataService";
    protected readonly fileService: FileService;
    canHandleSelection(selection: Object | undefined): number;
    protected isFileSelection(selection: Object | undefined): boolean;
    protected isNavigatableSelection(selection: Object | undefined): boolean;
    protected getFileStat(uri: URI): Promise<FileStat>;
    providePropertyData(selection: Object | undefined): Promise<FileStat | undefined>;
}
//# sourceMappingURL=resource-property-data-service.d.ts.map