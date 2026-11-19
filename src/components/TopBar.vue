<script setup lang="ts">
import { PanelLeft, Keyboard, Settings, Smartphone } from "@lucide/vue";
import ReadingPopover from "./ReadingPopover.vue";
import PhonePopover from "./PhonePopover.vue";
import { current } from "@/library";
import { ui, toggleSettings, toggleSide } from "@/ui";
import { showShortcuts } from "@/shortcuts";
import { MOD } from "@/lib/format";

// the phone button belongs on the Mac, not on the phone itself
const onMac = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
</script>

<template>
  <header class="top">
    <button
      class="ib"
      data-side-toggle
      :disabled="ui.view === 'settings'"
      title="Toggle chapters (B)"
      aria-label="Toggle chapter list"
      @click="toggleSide"
    >
      <PanelLeft :size="16" :stroke-width="1.5" />
    </button>
    <div class="brand">murmur</div>
    <div class="crumb">
      <template v-if="ui.view === 'settings'">Settings</template>
      <template v-else-if="current"
        ><span v-if="current.book" class="bk">{{ current.book }} ›</span>
        {{ current.title }}</template
      >
    </div>
    <div class="sp"></div>
    <button
      v-if="onMac"
      class="ib"
      popovertarget="phone"
      title="Listen on your phone"
      aria-label="Listen on your phone"
    >
      <Smartphone :size="16" :stroke-width="1.5" />
    </button>
    <button
      class="ib aa"
      popovertarget="aa"
      title="Reading settings (A)"
      aria-label="Reading settings"
    >
      Aa
    </button>
    <button
      class="ib"
      title="Keyboard shortcuts (?)"
      aria-label="Keyboard shortcuts"
      @click="showShortcuts"
    >
      <Keyboard :size="16" :stroke-width="1.5" />
    </button>
    <button class="ib" :title="`Settings (${MOD},)`" aria-label="Settings" @click="toggleSettings">
      <Settings :size="16" :stroke-width="1.5" />
    </button>
    <ReadingPopover />
    <PhonePopover v-if="onMac" />
  </header>
</template>

<style scoped>
.top {
  height: 44px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
.brand {
  font: 600 14px var(--ui);
  letter-spacing: -0.01em;
  color: var(--ink-hi);
  padding: 0 6px 0 2px;
}
.brand::before {
  content: "";
  display: inline-block;
  width: 8px;
  height: 14px;
  margin-right: 7px;
  vertical-align: -2px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--acc), var(--dlg));
}
.crumb {
  color: var(--ink2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-left: 10px;
  border-left: 1px solid var(--line);
  min-width: 0;
}
.aa {
  font: 600 13px var(--read);
  width: auto;
  padding: 0 8px;
}
@media (max-width: 820px) {
  .crumb {
    display: none;
  }
}
.bk {
  color: var(--ink3);
}
</style>
