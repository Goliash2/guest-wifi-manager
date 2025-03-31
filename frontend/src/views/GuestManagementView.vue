<script setup>
import { ref, onMounted, computed, reactive } from 'vue';
import { useAuthStore } from '@/stores/auth';
import apiClient from '@/services/api';
import { useToast } from 'primevue/usetoast';
import { useConfirm } from "primevue/useconfirm";
import { format, parseISO } from 'date-fns'; // For date formatting

// PrimeVue Components
import Button from 'primevue/button';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import InputText from 'primevue/inputtext';
import Calendar from 'primevue/calendar';
import Dialog from 'primevue/dialog';
import Card from 'primevue/card';
import Tag from 'primevue/tag';
import Toolbar from 'primevue/toolbar';
import ConfirmDialog from 'primevue/confirmdialog'; // Import Confirmation Dialog component
import ProgressSpinner from 'primevue/progressspinner';
import Checkbox from 'primevue/checkbox'; // For blocking in edit dialog

// State
const authStore = useAuthStore();
const toast = useToast();
const confirm = useConfirm();

const guests = ref([]);
const isLoading = ref(false);
const isCreating = ref(false);
const isEditing = ref(false);

const showCreateDialog = ref(false);
const showEditDialog = ref(false);

const newGuest = reactive({
  name: '',
  surname: '',
  email: '',
  valid_from: new Date(), // Default to today
  valid_until: null,
  department: null, // Department ID
});

const editingGuest = ref(null); // Holds the guest being edited
const editedGuestData = reactive({ // Holds data for the edit form
  id: null,
  valid_until: null,
  blocked: false,
});

// Computed properties
const canManageAll = computed(() => authStore.isAdmin);
// Simple way to get a default department ID if user only has one
const defaultDepartmentId = computed(() => authStore.userDepartments.length === 1 ? authStore.userDepartments[0] : null);

// Methods
const fetchGuests = async () => {
  isLoading.value = true;
  try {
    const response = await apiClient.get('/guests');
    guests.value = response.data;
  } catch (error) {
    console.error("Failed to fetch guests:", error);
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to load guests.', life: 3000 });
  } finally {
    isLoading.value = false;
  }
};

const openCreateDialog = () => {
  // Reset form
  newGuest.name = '';
  newGuest.surname = '';
  newGuest.email = '';
  newGuest.valid_from = new Date();
  newGuest.valid_until = null;
  // Pre-fill department if user has only one, otherwise require input
  newGuest.department = defaultDepartmentId.value;
  showCreateDialog.value = true;
};

const createGuest = async () => {
  if (!newGuest.name || !newGuest.surname || !newGuest.email || !newGuest.valid_until || !newGuest.department) {
    toast.add({ severity: 'warn', summary: 'Validation Error', detail: 'Please fill in all required fields.', life: 3000 });
    return;
  }
  isCreating.value = true;
  try {
    // Ensure dates are sent in a format the backend expects (ISO string recommended)
    const payload = {
      ...newGuest,
      valid_from: newGuest.valid_from.toISOString(),
      valid_until: newGuest.valid_until.toISOString(),
      // department is already set
    };
    await apiClient.post('/guests', payload);
    toast.add({ severity: 'success', summary: 'Success', detail: 'Guest created and credentials sent.', life: 3000 });
    showCreateDialog.value = false;
    fetchGuests(); // Refresh list
  } catch (error) {
    console.error("Failed to create guest:", error);
    toast.add({ severity: 'error', summary: 'Error', detail: error.response?.data?.message || 'Failed to create guest.', life: 4000 });
  } finally {
    isCreating.value = false;
  }
};

const openEditDialog = (guest) => {
  editingGuest.value = { ...guest }; // Copy guest data
  editedGuestData.id = guest.id;
  // Ensure dates are Date objects for the Calendar component
  editedGuestData.valid_until = guest.valid_until ? parseISO(guest.valid_until) : null;
  editedGuestData.blocked = guest.blocked;
  showEditDialog.value = true;
};

const updateGuest = async () => {
  if (!editedGuestData.id || !editedGuestData.valid_until) {
    toast.add({ severity: 'warn', summary: 'Validation Error', detail: 'Please select a valid until date.', life: 3000 });
    return;
  }
  isEditing.value = true;
  try {
    const payload = {
      valid_until: editedGuestData.valid_until.toISOString(),
      blocked: editedGuestData.blocked,
    };
    await apiClient.patch(`/guests/${editedGuestData.id}`, payload);
    toast.add({ severity: 'success', summary: 'Success', detail: 'Guest updated successfully.', life: 3000 });
    showEditDialog.value = false;
    fetchGuests(); // Refresh list
  } catch (error) {
    console.error("Failed to update guest:", error);
    toast.add({ severity: 'error', summary: 'Error', detail: error.response?.data?.message || 'Failed to update guest.', life: 4000 });
  } finally {
    isEditing.value = false;
  }
};

const confirmToggleBlock = (guest) => {
  const action = guest.blocked ? 'Unblock' : 'Block';
  confirm.require({
    message: `Are you sure you want to ${action} the guest "${guest.name} ${guest.surname}"?`,
    header: `${action} Confirmation`,
    icon: 'pi pi-exclamation-triangle',
    acceptClass: guest.blocked ? 'p-button-success' : 'p-button-danger',
    accept: async () => {
      await toggleBlockGuest(guest);
    },
    reject: () => {
      toast.add({ severity: 'info', summary: 'Cancelled', detail: `${action} cancelled`, life: 2000 });
    }
  });
};

const toggleBlockGuest = async (guest) => {
  const newBlockedStatus = !guest.blocked;
  try {
    await apiClient.patch(`/guests/${guest.id}`, { blocked: newBlockedStatus });
    toast.add({ severity: 'success', summary: 'Success', detail: `Guest ${newBlockedStatus ? 'blocked' : 'unblocked'}.`, life: 3000 });
    fetchGuests(); // Refresh list
  } catch (error) {
    console.error(`Failed to ${newBlockedStatus ? 'block' : 'unblock'} guest:`, error);
    toast.add({ severity: 'error', summary: 'Error', detail: error.response?.data?.message || `Failed to ${newBlockedStatus ? 'block' : 'unblock'} guest.`, life: 4000 });
  }
};

const formatDate = (value) => {
  if (!value) return '';
  try {
    // Expecting ISO string from backend
    return format(parseISO(value), 'yyyy-MM-dd HH:mm');
  } catch (e) {
    console.warn("Could not parse date:", value);
    return value; // Return original if parsing fails
  }
};

// Lifecycle Hooks
onMounted(() => {
  fetchGuests();
});

</script>

<template>
  <div class="p-4 md:p-8">
    <Toast />
    <ConfirmDialog /> {/* Needed for confirm.require */}

    <Toolbar class="mb-4">
      <template #start>
        <h1 class="text-xl md:text-2xl font-semibold text-surface-800 dark:text-surface-100">Guest Wi-Fi Management</h1>
      </template>
      <template #end>
        <Button label="Logout" icon="pi pi-sign-out" severity="secondary" @click="authStore.logout" class="mr-2" />
        <Button label="New Guest" icon="pi pi-plus" severity="success" @click="openCreateDialog" />
      </template>
    </Toolbar>

    <Card>
      <template #content>
        <DataTable :value="guests" :loading="isLoading" paginator :rows="10" :rowsPerPageOptions="[5, 10, 20, 50]"
          dataKey="id" stateStorage="session" stateKey="guest-table-state" sortMode="multiple" removableSort stripedRows
          size="small" tableClass="min-w-full">
          <template #header>
            <div class="flex justify-between items-center">
              <span class="text-lg font-semibold">Guest List</span>
              <Button icon="pi pi-refresh" rounded text severity="secondary" @click="fetchGuests" :disabled="isLoading"
                v-tooltip.left="'Refresh List'" />
            </div>
          </template>
          <template #loading>
            <div class="flex items-center justify-center p-4">
              <ProgressSpinner style="width: 50px; height: 50px" strokeWidth="8" fill="var(--surface-ground)"
                animationDuration=".5s" aria-label="Loading..." />
              <span class="ml-2">Loading guests...</span>
            </div>
          </template>
          <template #empty>
            <div class="text-center p-4">No guests found.</div>
          </template>

          <Column field="name" header="First Name" sortable filter filterPlaceholder="Search Name"
            style="min-width: 10rem">
          </Column>
          <Column field="surname" header="Last Name" sortable filter filterPlaceholder="Search Surname"
            style="min-width: 10rem"></Column>
          <Column field="email" header="Email" sortable filter filterPlaceholder="Search Email"
            style="min-width: 14rem">
          </Column>
          <Column field="valid_from" header="Valid From" sortable style="min-width: 10rem">
            <template #body="{ data }">
              {{ formatDate(data.valid_from) }}
            </template>
          </Column>
          <Column field="valid_until" header="Valid Until" sortable style="min-width: 10rem">
            <template #body="{ data }">
              {{ formatDate(data.valid_until) }}
            </template>
          </Column>
          <Column field="blocked" header="Status" sortable bodyClass="text-center" style="min-width: 8rem">
            <template #body="{ data }">
              <Tag :severity="data.blocked ? 'danger' : 'success'" :value="data.blocked ? 'Blocked' : 'Active'"></Tag>
            </template>
          </Column>
          <Column v-if="canManageAll" field="department" header="Department" sortable style="min-width: 8rem"></Column>
          <Column header="Actions" bodyClass="text-center" style="min-width: 10rem">
            <template #body="{ data }">
              <Button icon="pi pi-pencil" severity="info" text rounded @click="openEditDialog(data)"
                v-tooltip.top="'Edit Validity / Status'" class="mr-2" />
              <Button :icon="data.blocked ? 'pi pi-check-circle' : 'pi pi-ban'"
                :severity="data.blocked ? 'success' : 'danger'" text rounded @click="confirmToggleBlock(data)"
                :v-tooltip.top="data.blocked ? 'Unblock Guest' : 'Block Guest'" />
            </template>
          </Column>
        </DataTable>
      </template>
    </Card>

    <!-- Create Guest Dialog -->
    <Dialog v-model:visible="showCreateDialog" modal header="Create New Guest" :style="{ width: '30rem' }"
      :breakpoints="{ '1199px': '75vw', '575px': '90vw' }">
      <form @submit.prevent="createGuest" class="space-y-4 p-fluid">
        <div class="flex flex-col gap-2">
          <label for="newName">First Name</label>
          <InputText id="newName" v-model="newGuest.name" required autofocus />
        </div>
        <div class="flex flex-col gap-2">
          <label for="newSurname">Last Name</label>
          <InputText id="newSurname" v-model="newGuest.surname" required />
        </div>
        <div class="flex flex-col gap-2">
          <label for="newEmail">Email</label>
          <InputText id="newEmail" type="email" v-model="newGuest.email" required />
        </div>
        <!-- Department Input - Needs refinement based on how you manage departments -->
        <div class="flex flex-col gap-2">
          <label for="newDepartment">Department ID</label>
          <InputText id="newDepartment" type="number" v-model.number="newGuest.department" required
            :disabled="!!defaultDepartmentId" placeholder="Enter managing department ID" />
          <small v-if="defaultDepartmentId">Assigned to your department: {{ defaultDepartmentId }}</small>
          <small v-else-if="!canManageAll">Enter the ID of the department you manage.</small>
          <small v-else>Enter the ID of the department this guest belongs to.</small>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="flex flex-col gap-2">
            <label for="newValidFrom">Valid From</label>
            <Calendar id="newValidFrom" v-model="newGuest.valid_from" showTime hourFormat="24" dateFormat="yy-mm-dd"
              required showIcon touchUI />
          </div>
          <div class="flex flex-col gap-2">
            <label for="newValidUntil">Valid Until</label>
            <Calendar id="newValidUntil" v-model="newGuest.valid_until" showTime hourFormat="24" dateFormat="yy-mm-dd"
              required showIcon touchUI :minDate="newGuest.valid_from || new Date()" />
          </div>
        </div>

        <div class="flex justify-end gap-2 mt-6">
          <Button label="Cancel" severity="secondary" @click="showCreateDialog = false" :disabled="isCreating" />
          <Button type="submit" label="Create Guest" icon="pi pi-check" :loading="isCreating" />
        </div>
      </form>
    </Dialog>

    <!-- Edit Guest Dialog -->
    <Dialog v-model:visible="showEditDialog" modal header="Edit Guest" :style="{ width: '25rem' }">
      <div v-if="editingGuest" class="space-y-4 p-fluid">
        <p>Editing: <strong>{{ editingGuest.name }} {{ editingGuest.surname }}</strong> ({{ editingGuest.email }})</p>

        <div class="flex flex-col gap-2">
          <label for="editValidUntil">Extend Validity Until</label>
          <Calendar id="editValidUntil" v-model="editedGuestData.valid_until" showTime hourFormat="24"
            dateFormat="yy-mm-dd" required showIcon touchUI :minDate="new Date()" />
        </div>

        <div class="flex items-center gap-2">
          <Checkbox inputId="editBlocked" v-model="editedGuestData.blocked" :binary="true" />
          <label for="editBlocked">Blocked</label>
        </div>

        <div class="flex justify-end gap-2 mt-6">
          <Button label="Cancel" severity="secondary" @click="showEditDialog = false" :disabled="isEditing" />
          <Button label="Save Changes" icon="pi pi-save" @click="updateGuest" :loading="isEditing" />
        </div>
      </div>
    </Dialog>

  </div>
</template>

<style scoped>
/* Add component-specific styles if needed */
/* PrimeVue's p-fluid class helps with form layout */
</style>
