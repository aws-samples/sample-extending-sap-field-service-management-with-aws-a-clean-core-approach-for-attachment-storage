#!/usr/bin/env node

// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

process.env.AWS_SDK_LOAD_CONFIG = "1";
const { default: s3SpaUpload } = require("s3-spa-upload");
const fs = require("fs");
const path = require("path");
const proc = require("node:child_process");
const os = require("os");

// Is the current platform Windows ?
const isWindows = os.platform() === "win32";
const command = isWindows ? "npm.cmd" : "npm";

proc.execFileSync(command, ["run", "build", ...process.argv.slice(2)], {
  cwd: __dirname,
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_APP_BUILD_DATE: new Date().toISOString(),
  },
});

s3SpaUpload(path.join(__dirname, "dist"), readEnvFile(), {
  cacheControlMapping: {
    "index.html": "public,max-age=60,stale-while-revalidate=31536000",
    "*.woff": "public,max-age=86400,stale-while-revalidate=31536000",
    "*.js": "public,max-age=31536000,immutable",
    "*.js.map": "public,max-age=31536000,immutable",
    "*.css": "public,max-age=31536000,immutable",
    "*.svg": "public,max-age=86400,stale-while-revalidate=31536000",
    "appconfig.json": "public,max-age=86400,stale-while-revalidate=31536000",
  },
  delete: true,
});

function readEnvFile() {
  function tryReadEntry(fname) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      return fs
        .readFileSync(path.join(__dirname, fname), "utf8")
        .split("\n")
        .filter((l) => !!l && l.startsWith("CDK_STACK_SPA_BUCKET_NAME"))
        .at(0)
        ?.replace("CDK_STACK_SPA_BUCKET_NAME=", "");
    } catch {
      return;
    }
  }
  const sesSenderEmailIdentityArn =
    tryReadEntry(".env.local") ?? tryReadEntry(".env");
  if (!sesSenderEmailIdentityArn) {
    throw new Error(
      "Failed to read CDK_STACK_SPA_BUCKET_NAME config from .env file"
    );
  }
  return sesSenderEmailIdentityArn;
}
