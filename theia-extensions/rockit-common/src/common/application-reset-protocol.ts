export const ApplicationResetService = Symbol('ApplicationResetService')
export const APPLICATION_RESET_PATH = '/services/application-reset'

export interface ApplicationResetResult {
  rockitRootPath: string
}

export interface ApplicationResetService {
  resetApplication(): Promise<ApplicationResetResult>
}
