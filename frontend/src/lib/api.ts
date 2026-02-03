import axios from 'axios'

// Get API URL - throws at runtime if not set
function getApiUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL
  if (!url) {
    throw new Error('NEXT_PUBLIC_API_URL environment variable is required')
  }
  return url
}

// Create axios instance lazily to avoid runtime errors during SSR/build
let apiInstance: ReturnType<typeof axios.create> | null = null

export function getApi() {
  if (!apiInstance) {
    apiInstance = axios.create({
      baseURL: getApiUrl(),
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }
  return apiInstance
}

// Export a proxy that creates the instance on first use
export const api = {
  get: (url: string) => getApi().get(url),
  post: (url: string, data?: unknown) => getApi().post(url, data),
  put: (url: string, data?: unknown) => getApi().put(url, data),
  delete: (url: string) => getApi().delete(url),
}
