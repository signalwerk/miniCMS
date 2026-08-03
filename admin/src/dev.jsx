import { init } from "./main.jsx";

init({
  target: "#root",
  adapter: "api",
  apiOptions: { apiUrl: import.meta.env.MINICMS_PUBLIC_API_URL }
}).catch(() => {});
