import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { HttpAiClient, ScriptedAiClient, withFallback } from "./ai-client";
import { createGameDatabase } from "./storage";
import { createGameStore } from "./store";
import "./style.css";

// 装配真实 store：LLM（经 dev-server 代理）为主，脚本AI 兜底；持久化走 IndexedDB。
const ai = withFallback(new HttpAiClient(), new ScriptedAiClient());
const db = createGameDatabase("xiaolangsha");
const store = createGameStore({ ai, db });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
