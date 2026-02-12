export const SecureStorageService = Symbol('SecureStorageService');
export const SECURE_STORAGE_PATH = '/services/secure-storage';

export interface SecureStorageService {
    setPassword(service: string, account: string, password: string): Promise<void>;
    getPassword(service: string, account: string): Promise<string | null>;
    deletePassword(service: string, account: string): Promise<boolean>;
    findCredentials(service: string): Promise<{ account: string; password: string }[]>;
}