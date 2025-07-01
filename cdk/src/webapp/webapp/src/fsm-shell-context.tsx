// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { createContext, useContext, useState } from "react";
import { ShellSdk, SHELL_EVENTS } from "fsm-shell";
import * as model from "./model";

const FsmShellContext = createContext<ReturnType<typeof _useFsmShellContext>>(
  undefined as any
);

export function useFsmShellContext() {
  return useContext(FsmShellContext);
}

export const FsmShellContextProvider = (props: {
  children: React.ReactNode;
}) => {
  return (
    <FsmShellContext.Provider value={_useFsmShellContext()}>
      {props.children}
    </FsmShellContext.Provider>
  );
};

export function _useFsmShellContext() {
  if (!ShellSdk.isInsideShell()) {
    return {
      context: undefined,
      isLoading: false,
    };
  }
  const [context, setContext] = useState<model.FsmShellContext>();
  const shellSdk = ShellSdk.init(parent, "*");
  React.useEffect(() => {
    function handleContext(event: string) {
      console.log("Received SAP FSM context");
      setContext(JSON.parse(event));
    }
    function handleAccessToken(auth: model.FsmShellContext["auth"]) {
      console.log("Received SAP FSM access token");
      setContext((context) => context && { ...context, auth });
    }
    shellSdk.on(SHELL_EVENTS.Version1.REQUIRE_CONTEXT, handleContext);
    shellSdk.on(
      SHELL_EVENTS.Version1.REQUIRE_AUTHENTICATION,
      handleAccessToken
    );
    return () => {
      shellSdk.off(SHELL_EVENTS.Version1.REQUIRE_CONTEXT, handleContext);
      shellSdk.off(
        SHELL_EVENTS.Version1.REQUIRE_AUTHENTICATION,
        handleAccessToken
      );
    };
  }, []);
  React.useEffect(() => {
    if (!context) {
      console.log("Requesting SAP FSM context ...");
      shellSdk.emit(SHELL_EVENTS.Version1.REQUIRE_CONTEXT, {
        auth: {
          response_type: "token",
        },
      });
    } else if (!context.auth?.access_token) {
      console.log("Requesting SAP FSM access token ...");
      shellSdk.emit(SHELL_EVENTS.Version1.REQUIRE_AUTHENTICATION, {
        response_type: "token",
      });
    }
  });

  const contextTokenExpiry = context?.auth?.expires_in;
  React.useEffect(() => {
    if (!contextTokenExpiry) return;
    let lastExecution = Date.now();
    const intervalDuration = (contextTokenExpiry - 10) * 1000;
    const checkAndEmit = () => {
      const now = Date.now();
      if (now - lastExecution >= intervalDuration) {
        console.log("Requesting SAP FSM access token ...");
        shellSdk.emit(SHELL_EVENTS.Version1.REQUIRE_AUTHENTICATION, {
          response_type: "token",
        });
        lastExecution = now;
      }
    };
    const i = setInterval(checkAndEmit, 1000);
    return () => clearInterval(i);
  }, [contextTokenExpiry]);
  return { context, isLoading: !context?.auth?.access_token };
}
