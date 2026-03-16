import { inject, injectable } from 'inversify';
import { SchemaValidator, ValidationError, MetadataSchemaManager } from 'aroma2-common/lib/browser';
import { validateEntities, validate } from './ro-crate-validator';
import { AppStateService } from 'app-state/lib/browser/state/app-state-service';

@injectable()
export class SchemaValidatorService implements SchemaValidator {
  @inject(MetadataSchemaManager) protected readonly schemaManagerService: MetadataSchemaManager
  @inject(AppStateService) protected readonly appStateService: AppStateService

  async validateEntities(
    crate: Record<string, any>,
    baseProfile: Record<string, any>,
    profile: Record<string, any>,
    completeProfile: Record<string, any>
  ): Promise<ValidationError[] | undefined> {
    return validateEntities(
      crate,
      baseProfile,
      profile,
      completeProfile,
      this.appStateService.profileList,
      this.schemaManagerService,
    );
  }

  validate(entity: Record<string, any>, profile: Record<string, any>): ValidationError[] {
    return validate(entity, profile);
  }
}