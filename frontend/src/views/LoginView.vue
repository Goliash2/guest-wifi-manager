<script setup>
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToast } from 'primevue/usetoast';

import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Card from 'primevue/card';
import Message from 'primevue/message';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const toast = useToast();

const username = ref('');
const password = ref('');
const isLoading = ref(false);
const error = ref(null);

const handleLogin = async () => {
  isLoading.value = true;
  error.value = null;
  try {
    const success = await authStore.login({
      username: username.value,
      password: password.value,
    });
    if (success) {
      toast.add({ severity: 'success', summary: 'Success', detail: 'Logged in successfully', life: 3000 });
      // Redirect to intended page or default
      const redirectPath = route.query.redirect || '/guests';
      router.push(redirectPath);
    }
    // Login function in store should throw error on failure
  } catch (err) {
    console.error("Login failed:", err);
    error.value = err.response?.data?.message || 'Login failed. Please check your credentials.';
    toast.add({ severity: 'error', summary: 'Login Failed', detail: error.value, life: 5000 });
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
  <div class="flex items-center justify-center min-h-screen bg-surface-100 dark:bg-surface-900 px-4">
    <Card class="w-full max-w-md">
      <template #title>
        <h2 class="text-2xl font-bold text-center text-primary-500 dark:text-primary-400">Guest Wi-Fi Login</h2>
      </template>
      <template #content>
        <form @submit.prevent="handleLogin" class="space-y-6">
          <div class="flex flex-col gap-2">
            <label for="username">Username</label>
            <InputText id="username" v-model="username" required :disabled="isLoading"
              aria-describedby="username-help" />
            <!-- <small id="username-help">Enter your management username.</small> -->
          </div>

          <div class="flex flex-col gap-2">
            <label for="password">Password</label>
            <Password id="password" v-model="password" required :feedback="false" toggleMask :disabled="isLoading" />
          </div>

          <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

          <Button type="submit" label="Login" icon="pi pi-sign-in" class="w-full" :loading="isLoading"
            :disabled="isLoading" />
        </form>
      </template>
    </Card>
  </div>
</template>
