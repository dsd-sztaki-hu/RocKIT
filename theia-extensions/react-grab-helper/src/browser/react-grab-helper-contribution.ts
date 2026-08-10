import type {
  FrontendApplication,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import { PreferenceChange, PreferenceService } from '@theia/core'
import { Disposable } from '@theia/core/lib/common/disposable'
import { inject, injectable } from '@theia/core/shared/inversify'
import type { ReactGrabAPI } from 'react-grab/dist/core'
import { ROCKIT_REACT_GRAB_ENABLED } from '../common/react-grab-helper-preferences'

@injectable()
export class GrabHelperContribution implements FrontendApplicationContribution {
  @inject(PreferenceService)
  protected readonly preferenceService: PreferenceService

  protected grabApi: ReactGrabAPI | undefined
  protected preferenceListener: Disposable | undefined
  protected updateToken = 0

  async onStart(_app: FrontendApplication): Promise<void> {
    // Enable only during development (React Grab’s recommended usage)
    if (process.env.NODE_ENV !== 'development') {
      return
    }

    this.preferenceListener = this.preferenceService.onPreferenceChanged((change: PreferenceChange) => {
      if (change.preferenceName === ROCKIT_REACT_GRAB_ENABLED) {
        void this.updateEnabledState()
      }
    })
    await this.updateEnabledState()
  }

  onStop(): void {
    this.preferenceListener?.dispose()
    this.preferenceListener = undefined
    this.updateToken += 1
    this.disableReactGrab()
  }

  protected async updateEnabledState(): Promise<void> {
    const updateToken = ++this.updateToken
    const enabled = this.preferenceService.get<boolean>(ROCKIT_REACT_GRAB_ENABLED, false)

    if (!enabled) {
      this.disableReactGrab()
      return
    }
    if (this.grabApi) {
      return
    }

    const { init } = await import('react-grab/dist/core')
    if (
      updateToken !== this.updateToken ||
      !this.preferenceService.get<boolean>(ROCKIT_REACT_GRAB_ENABLED, false)
    ) {
      return
    }

    this.grabApi = init()
    console.log('[grab-helper] React Grab initialized.')
  }

  protected disableReactGrab(): void {
    if (this.grabApi) {
      this.grabApi.dispose()
      this.grabApi = undefined
      console.log('[grab-helper] React Grab disabled.')
    }
  }
}
