#!/usr/bin/env node

// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { SapFsmAttachmentBackup } from "../lib/webhook-to-event";
import { S3AttachmentBackup } from "../lib/s3-attachment-backup";
import { CloudfrontServedEmptySpaBucket } from "../lib/extension-hosting";
import { ExtensionBackend } from "../lib/extension-backend";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { SapFsmCustomRule } from "../lib/custom-rule";
import { WebApp } from "../lib/webapp";
import { FsmParameters } from "../lib/fsm-parameters";

const app = new cdk.App();
cdk.Aspects.of(app).add(new AwsSolutionsChecks());
const stack = new cdk.Stack(app, "SapFsmAttachmentBackupStack", {});

// Define CDK Parameters
const fsmClientIdParam = new cdk.CfnParameter(stack, "SapFsmClientId", {
  type: "String",
  default: "AWS-S3-Backup-Solution",
  description:
    "Client ID for SAP FSM (to be used as x-client-id when calling SAP FSM APIs)",
});

const fsmClientVersionParam = new cdk.CfnParameter(
  stack,
  "SapFsmClientVersion",
  {
    type: "String",
    default: "1.0.0",
    description:
      "Client Version for SAP FSM (to be used as x-client-version when calling SAP FSM APIs)",
  }
);

const fsmAccountIdParam = new cdk.CfnParameter(stack, "SapFsmAccountId", {
  type: "String",
  description: "Account ID for SAP FSM",
  minLength: 1,
});

const fsmCompanyIdParam = new cdk.CfnParameter(stack, "SapFsmCompanyId", {
  type: "String",
  description: "Company ID for SAP FSM",
  minLength: 1,
});

const sapFsmBaseUrlParam = new cdk.CfnParameter(stack, "SapFsmBaseUrl", {
  type: "String",
  default: "https://eu.fsm.cloud.sap",
  description: "Base URL of SAP FSM",
});

const jwksPathParam = new cdk.CfnParameter(stack, "JwksPath", {
  type: "String",
  default: "/api/oauth2/v2/.well-known/jwks.json",
  description: "JWKS path to SAP JWT public key",
});

const oauthTokenPathParam = new cdk.CfnParameter(stack, "OAuthTokenPath", {
  type: "String",
  default: "/api/oauth2/v1/token",
  description: "OAuth token path",
});

const attachmentApiPathParam = new cdk.CfnParameter(
  stack,
  "AttachmentApiPath",
  {
    type: "String",
    default:
      "/cloud-attachment-service/api/v1/Attachment/{attachment_id}/content",
    description: "Attachment API path",
  }
);

const businessRuleApiPathParam = new cdk.CfnParameter(
  stack,
  "BusinessRuleApiPath",
  {
    type: "String",
    default: "/api/data/v4/CustomRule",
    description: "Business Rule API Path",
  }
);

const createNewCloudTrailParam = new cdk.CfnParameter(stack, "CreateNewTrail", {
  type: "String",
  default: "false",
  allowedValues: ["true", "false"],
  description:
    "Should an AWS CloudTrail trail be created (true or false)? Set this to true if you don't have a trail yet in this region",
});

// Create a struct (object) for FSM parameters
const fsmParams: FsmParameters = {
  clientId: fsmClientIdParam.valueAsString,
  clientVersion: fsmClientVersionParam.valueAsString,
  accountId: fsmAccountIdParam.valueAsString,
  companyId: fsmCompanyIdParam.valueAsString,
  createNewCloudTrail: createNewCloudTrailParam.valueAsString === "true",
  sapFsmBaseUrl: sapFsmBaseUrlParam.valueAsString,
  jwksPath: jwksPathParam.valueAsString,
  oauthTokenPath: oauthTokenPathParam.valueAsString,
  attachmentApiPath: attachmentApiPathParam.valueAsString,
  businessRuleApiPath: businessRuleApiPathParam.valueAsString,
};

const webhook = new SapFsmAttachmentBackup(stack, "Webhook");
const backup = new S3AttachmentBackup(stack, "AttachmentBackup", {
  eventBus: webhook.eventBus,
  eventSource: webhook.eventSource,
  fsmParameters: fsmParams,
});
new SapFsmCustomRule(stack, "CustomRule", {
  apiKeyArn: webhook.apiKeyArn,
  clientSecretArn: backup.clientSecretArn,
  apiWebhookUrl: webhook.webhookUrl,
  apiKeyId: webhook.apiKeyId,
  fsmParameters: fsmParams,
});
const extensionHosting = new CloudfrontServedEmptySpaBucket(
  stack,
  "ExtensionHosting",
  {
    csp: {
      frameAncestors: cdk.Fn.select(
        1,
        cdk.Fn.split("//", fsmParams.sapFsmBaseUrl)
      ),
      connectSrc: "'self'",
    },
  }
);
// Force CloudFront distribution creation to wait for attachment backup function deployment.
// Reason: if users use the CFN quick-create-link from the wrong region, Lambda functions will fail to deploy.
// It's very annoying to have to wait for CFN to rollback the CloudFront distribution then!
// So let's wait with creating the CloudFront distribution until we know the Lambda functions deploy ok
extensionHosting.distribution.node.addDependency(backup.attachmentBackupFn);

new WebApp(stack, "WebApp", { bucket: extensionHosting.bucket });
new ExtensionBackend(stack, "ExtensionBackend", {
  bucket: backup.bucket,
  backupFunction: backup.attachmentBackupFn,
  api: webhook.api,
  distribution: extensionHosting.distribution,
  sapFsm: {
    accountId: fsmParams.accountId,
    companyId: fsmParams.companyId,
    sapFsmBaseUri: fsmParams.sapFsmBaseUrl,
    jwksPath: fsmParams.jwksPath,
  },
});
new cdk.CfnOutput(stack, "ExtensionHostingUrl", {
  value: `https://${extensionHosting.distribution.domainName}`,
});
new cdk.CfnOutput(stack, "ExtensionHostingBucketName", {
  value: extensionHosting.bucket.bucketName,
});
NagSuppressions.addStackSuppressions(stack, [
  {
    id: "AwsSolutions-IAM4",
    reason:
      "Curated list of Managed Policies are allowed as they are not over-privileged",
    appliesTo: [
      "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
    ],
  },
]);

const fsmTenantParameters = [
  fsmAccountIdParam.logicalId,
  fsmCompanyIdParam.logicalId,
  sapFsmBaseUrlParam.logicalId,
];
stack.addMetadata("AWS::CloudFormation::Interface", {
  ParameterGroups: [
    {
      Label: { default: "SAP FSM Tenant" },
      Parameters: fsmTenantParameters,
    },
    {
      Label: { default: "Advanced configuration" },
      Parameters: stack.node
        .findAll()
        .filter((c) => c instanceof cdk.CfnParameter)
        .map((c) => c.logicalId)
        .filter((logicalId) => !fsmTenantParameters.includes(logicalId)),
    },
  ],
});
