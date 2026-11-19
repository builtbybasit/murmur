import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";
import { startSync } from "./sync";

startSync().then(
  () => createApp(App).mount("#app"),
  (e: Error) =>
    (document.getElementById("app")!.textContent =
      "Can't reach the lectern server (" + e.message + "). Is `bun run dev` running?"),
);
