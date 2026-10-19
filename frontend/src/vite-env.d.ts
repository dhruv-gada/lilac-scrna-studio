/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE: "api" | "mock";
  readonly VITE_API_URL?: string;
}
