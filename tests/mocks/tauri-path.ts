export const appDataDir = async () => '/mock/app/data/'
export const join = async (...paths: string[]) => paths.join('/').replace(/\/+/g, '/')
