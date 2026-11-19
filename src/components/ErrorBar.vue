<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { TriangleAlert } from "@lucide/vue";
import { providerById } from "@/settings";
import { openSettings } from "@/ui";
import { player, retry, skip } from "@/engine";

const host = (url = "") => url.replace(/^https?:\/\//, "").replace(/\/.*$/, "") || "the provider";

// ticks only while an automatic retry is pending, for the countdown
const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | undefined;
watch(
  () => player.error?.retryAt,
  (at) => {
    clearInterval(tick);
    now.value = Date.now();
    if (at) tick = setInterval(() => (now.value = Date.now()), 250);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(tick));

const err = computed(() => {
  const e = player.error;
  if (!e) return null;
  const p = providerById(e.providerId);
  const name = p?.name || "The provider";
  let code: string, msg: string;
  if (e.code === "auth") {
    code = `${e.status || 401} ${e.status === 403 ? "Forbidden" : "Unauthorized"}`;
    msg = `${name} rejected the API key. Nothing is retried until the key is fixed.`;
  } else {
    if (e.code === "rate") {
      code = "429 Too Many Requests";
      msg = `${name} is rate limiting.`;
    } else if (e.code === "network") {
      code = "Network error";
      msg = `Can't reach ${host(p?.baseUrl)}. Is the server running?`;
    } else {
      code = `HTTP ${e.status}`;
      msg = e.message || `${name} returned an error.`;
    }
    if (e.gaveUp) msg += ` Gave up after ${e.maxAttempts} attempts.`;
    else if (e.retryAt) {
      const secs = Math.max(0, Math.ceil((e.retryAt - now.value) / 1000));
      msg += ` Retrying in ${secs} s (attempt ${e.attempt} of ${e.maxAttempts}).`;
    }
  }
  return {
    code,
    msg,
    pid: e.providerId,
    auth: e.code === "auth",
    auto: !!e.retryAt && !e.gaveUp,
    openProv: (e.code === "network" || e.code === "http") && !e.gaveUp,
  };
});
</script>

<template>
  <div v-if="err" class="errbar" role="status">
    <span class="code"><TriangleAlert :size="16" :stroke-width="1.75" />{{ err.code }}</span>
    <span class="msg">{{ err.msg }}</span>
    <button v-if="err.auth" class="btn pri" @click="openSettings('providers', err.pid, true)">
      Fix key
    </button>
    <button class="btn" :class="{ pri: !err.auth }" @click="retry()">
      {{ err.auto ? "Retry now" : "Retry" }} <kbd>R</kbd>
    </button>
    <button v-if="err.openProv" class="btn" @click="openSettings('providers', err.pid)">
      Open provider
    </button>
    <button class="btn ghost" @click="skip()">Skip segment</button>
  </div>
</template>

<style scoped>
.errbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 8px 14px;
  background: color-mix(in srgb, var(--err) 11%, var(--surface));
  border-top: 1px solid color-mix(in srgb, var(--err) 45%, var(--line));
  color: var(--ink);
}
.errbar .code {
  font: 600 12px var(--mono);
  color: var(--err);
  display: flex;
  gap: 6px;
  align-items: center;
}
.errbar .msg {
  flex: 1;
  min-width: 220px;
}
</style>
