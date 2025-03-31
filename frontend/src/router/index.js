import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import LoginView from '../views/LoginView.vue'
import GuestManagementView from '../views/GuestManagementView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { requiresGuest: true }, // Redirect if already logged in
    },
    {
      path: '/', // Redirect root to guest management
      redirect: '/guests',
    },
    {
      path: '/guests',
      name: 'guests',
      component: GuestManagementView,
      meta: { requiresAuth: true }, // Requires login
    },
    // Catch-all route (optional)
    // { path: '/:pathMatch(.*)*', redirect: '/' }
  ],
})

// Navigation Guard
router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()

  // Check token validity on each navigation
  authStore.checkTokenValidity()

  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth)
  const requiresGuest = to.matched.some((record) => record.meta.requiresGuest)

  if (requiresAuth && !authStore.isAuthenticated) {
    // Redirect to login page if trying to access protected route without auth
    next({ name: 'login', query: { redirect: to.fullPath } }) // Optional: redirect back after login
  } else if (requiresGuest && authStore.isAuthenticated) {
    // Redirect to guest management if trying to access login page while authenticated
    next({ name: 'guests' })
  } else {
    // Otherwise, allow navigation
    next()
  }
})

export default router
