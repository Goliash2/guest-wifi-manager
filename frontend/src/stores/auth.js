import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import apiClient from '@/services/api'
import { jwtDecode } from 'jwt-decode'

export const useAuthStore = defineStore('auth', () => {
  const router = useRouter()
  const token = ref(localStorage.getItem('authToken') || null)
  const user = ref(JSON.parse(localStorage.getItem('authUser') || '{}'))

  const isAuthenticated = computed(() => !!token.value)
  const isAdmin = computed(() => user.value?.role === 'admin')
  const userDepartments = computed(() => user.value?.departments || [])

  function setToken(newToken) {
    token.value = newToken
    if (newToken) {
      localStorage.setItem('authToken', newToken)
      try {
        const decoded = jwtDecode(newToken)
        // Store relevant user info (don't store sensitive info)
        const userData = {
          id: decoded.id,
          role: decoded.role,
          departments: decoded.departments,
        }
        user.value = userData
        localStorage.setItem('authUser', JSON.stringify(userData))
      } catch (error) {
        console.error('Failed to decode token:', error)
        logout() // Clear invalid token/user data
      }
    } else {
      localStorage.removeItem('authToken')
      localStorage.removeItem('authUser')
      user.value = {}
    }
  }

  async function login(credentials) {
    // Make API call using apiClient
    const response = await apiClient.post('/login', credentials)
    if (response.data.token) {
      setToken(response.data.token)
      return true
    }
    return false
  }

  function logout() {
    setToken(null)
    router.push('/login')
  }

  // Optionally: Check token validity on app load/refresh
  function checkTokenValidity() {
    if (token.value) {
      try {
        const decoded = jwtDecode(token.value)
        const currentTime = Date.now() / 1000
        if (decoded.exp && decoded.exp < currentTime) {
          console.log('Token expired, logging out.')
          logout()
        } else {
          // Token is still valid, ensure user data is loaded
          if (!user.value || !user.value.id) {
            user.value = JSON.parse(localStorage.getItem('authUser') || '{}')
          }
        }
      } catch (error) {
        console.error('Invalid token found:', error)
        logout()
      }
    }
  }

  return {
    token,
    user,
    isAuthenticated,
    isAdmin,
    userDepartments,
    login,
    logout,
    setToken, // Might be useful if handling redirects from OAuth etc.
    checkTokenValidity,
  }
})
