<script setup lang="ts">
// Provider <select> + model input with that provider's models as suggestions. Goes inside a `.f`.
import { useId } from "vue";
import { settings, providerById, type ProviderKind } from "@/settings";

defineProps<{ kind: ProviderKind; placeholder: string; disabled?: boolean }>();
defineEmits<{ change: [] }>();
const providerId = defineModel<string | null>("providerId", { required: true });
const model = defineModel<string>("model", { required: true });
const list = useId();
</script>

<template>
  <label
    >Provider<select v-model="providerId" :disabled="disabled" @change="$emit('change')">
      <option v-if="!settings.providers.some((p) => p.kind === kind)" :value="null">
        No {{ kind.toUpperCase() }} providers yet
      </option>
      <option v-else-if="!providerById(providerId)" :value="providerId" disabled>
        Choose a provider
      </option>
      <template v-for="p in settings.providers" :key="p.id">
        <option v-if="p.kind === kind || p.id === providerId" :value="p.id">{{ p.name }}</option>
      </template>
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
