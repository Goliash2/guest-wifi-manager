import axios from 'axios'
import { useAuthStore } from '@/stores/auth' // We'll create this store

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api', // Use env var or proxy
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request Interceptor to add JWT token
apiClient.interceptors.request.use(
  (config) => {
    const authStore = useAuthStore()
    const token = authStore.token
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  },
)

// Response Interceptor (Optional: Handle 401 Unauthorized globally)
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      const authStore = useAuthStore()
      authStore.logout() // Trigger logout action
      // Optionally redirect to login or show a message
      // router.push('/login'); // If router is accessible here
    }
    return Promise.reject(error)
  },
)

export default apiClient
