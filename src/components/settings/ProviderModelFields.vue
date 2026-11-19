<script setup lang="ts">
// Provider <select> + model input with that provider's models as suggestions. Goes inside a `.f`.
import { useId } from "vue";
import { settings, providerById } from "../../settings";

defineProps<{ placeholder: string; disabled?: boolean }>();
defineEmits<{ change: [] }>();
const providerId = defineModel<string | null>("providerId", { required: true });
const model = defineModel<string>("model", { required: true });
const list = useId();
</script>

<template>
  <label
    >Provider<select v-model="providerId" :disabled="disabled" @change="$emit('change')">
      <option v-if="!settings.providers.length" :value="null">No providers yet</option>
      <option v-else-if="!providerById(providerId)" :value="providerId" disabled>
        Choose a provider
      </option>
      <option v-for="p in settings.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
    </select></label
  >
  <label
    >Model<input
      v-model.trim="model"
      type="text"
      class="monoi"
      :list="list"
      :placeholder="placeholder"
      :disabled="disabled"
    />
    <datalist :id="list">
      <option v-for="m in providerById(providerId)?.models" :key="m" :value="m" />
    </datalist>
  </label>
</template>
