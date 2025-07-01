// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FsmShellContextProvider } from "./fsm-shell-context.tsx";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FsmShellContextProvider>
      <App />
    </FsmShellContextProvider>
  </StrictMode>
);
