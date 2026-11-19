import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";
import { startSync } from "./sync";

createApp(App).mount("#app");
void startSync();
