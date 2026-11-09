export const isWebApp = import.meta.env.MODE === 'web'

export function publicAsset(name: string): string {
  return import.meta.env.BASE_URL + name
}
