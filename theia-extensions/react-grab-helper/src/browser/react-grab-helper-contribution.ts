import type {
  FrontendApplication,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import { injectable } from '@theia/core/shared/inversify'

@injectable()
export class GrabHelperContribution implements FrontendApplicationContribution {
  async onStart(_app: FrontendApplication): Promise<void> {
    // Enable only during development (React Grab’s recommended usage)
    if (process.env.NODE_ENV !== 'development') {
      return
    }

    console.log('[grab-helper] Loading React Grab…')

    // Simple mode: load React Grab. It auto-hooks into the DOM.
    await import('react-grab')

    console.log('[grab-helper] React Grab initialized.')
  }
}
