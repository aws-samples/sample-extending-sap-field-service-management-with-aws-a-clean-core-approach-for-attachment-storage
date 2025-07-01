// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { execSync } from "child_process";
import {
  CloudFormationCustomResourceHandler,
  CloudFormationCustomResourceDeleteEvent,
  CloudFormationCustomResourceUpdateEvent,
} from "aws-lambda";
import s3SpaUpload from "s3-spa-upload";
import { existsSync, mkdirSync } from "fs";
import { ncp } from "ncp";
import { sendCfnResponse, Status } from "./cfn-response";

interface Configuration {
  BucketName: string;
  ClientId: string;
  Fido2BaseUrl: string;
}

async function buildSpa(config: Configuration) {
  const temp_dir = "/tmp/webapp";
  const home_dir = "/tmp/home";

  if (!existsSync(home_dir)) {
    mkdirSync(home_dir);
  }

  console.log(
    `Copying SPA sources to ${temp_dir} and making dependencies available there ...`
  );

  await new Promise<void>((resolve, reject) => {
    ncp(`${__dirname}/webapp`, temp_dir, (err) =>
      err ? reject(err) : resolve()
    );
  });

  console.log("NPM version:");
  execSync("npm -v", {
    cwd: temp_dir,
    stdio: "inherit",
    env: { ...process.env, HOME: home_dir },
  });
  console.log(`Installing dependencies to build React app in ${temp_dir} ...`);
  execSync("npm ci", {
    cwd: temp_dir,
    stdio: "inherit",
    env: { ...process.env, HOME: home_dir },
  });
  console.log(`Running build of React app in ${temp_dir} ...`);
  execSync("npm run build", {
    cwd: temp_dir,
    stdio: "inherit",
    env: { ...process.env, HOME: home_dir },
  });
  console.log("Build succeeded");

  return `${temp_dir}/dist`;
}

async function buildUploadSpa(
  action: "Create" | "Update" | "Delete",
  config: Configuration,
  physicalResourceId?: string
) {
  if (action === "Create" || action === "Update") {
    const buildDir = await buildSpa(config);
    await s3SpaUpload(buildDir, config.BucketName);
  } else {
    // "Trick" to empty the bucket is to upload an empty dir
    mkdirSync("/tmp/empty_directory", { recursive: true });
    await s3SpaUpload("/tmp/empty_directory", config.BucketName, {
      delete: true,
    });
  }
  return physicalResourceId || "ReactApp";
}

export const handler: CloudFormationCustomResourceHandler = async (
  event,
  context
) => {
  console.log(JSON.stringify(event, undefined, 4));

  const { ResourceProperties, RequestType } = event;

  const { ServiceToken, ...config } = ResourceProperties;

  const { PhysicalResourceId } = event as
    | CloudFormationCustomResourceDeleteEvent
    | CloudFormationCustomResourceUpdateEvent;

  let status = Status.SUCCESS;
  let physicalResourceId: string | undefined;
  let data: { [key: string]: any } | undefined;
  let reason: string | undefined;
  try {
    physicalResourceId = await Promise.race([
      buildUploadSpa(RequestType, config as Configuration, PhysicalResourceId),
      new Promise<undefined>((_, reject) =>
        setTimeout(
          () => reject(new Error("Task timeout")),
          context.getRemainingTimeInMillis() - 500
        )
      ),
    ]);
  } catch (err) {
    console.error(err);
    status = Status.FAILED;
    reason = `${err}`;
  }
  await sendCfnResponse({
    event,
    status,
    data,
    physicalResourceId,
    reason,
  });
};
