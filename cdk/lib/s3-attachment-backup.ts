// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as eventTargets from "aws-cdk-lib/aws-events-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import * as fs from "fs";
import * as path from "path";
import { NagSuppressions } from "cdk-nag";
import { FsmParameters } from "./fsm-parameters";

export class S3AttachmentBackup extends Construct {
  bucket: s3.Bucket;
  attachmentBackupFn: lambda.Function;

  clientSecretArn: string;
  constructor(
    scope: Construct,
    id: string,
    props: {
      eventBus: events.EventBus;
      eventSource: string;
      fsmParameters: FsmParameters;
    }
  ) {
    super(scope, id);

    const logBucket = new s3.Bucket(this, "SapFsmAttachmentsAccessLogs", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const bucket = new s3.Bucket(scope, "SapFsmAttachments", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      versioned: true,
      enforceSSL: true,
      serverAccessLogsBucket: logBucket,
      serverAccessLogsPrefix: "sap-fsm-attachments-logs/",
      encryption: s3.BucketEncryption.KMS,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });
    this.bucket = bucket;

    const clientSecret = new secrets.Secret(scope, "ClientSecret", {
      secretName: cdk.Fn.join("-", [
        cdk.Aws.STACK_NAME,
        "sap-fsm-s3-backup-client",
      ]),
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          clientId: "XXXXXXX",
          clientSecret: "XXXXXXXX",
          fsmClientId: props.fsmParameters.clientId,
          fsmClientVersion: props.fsmParameters.clientVersion,
          fsmAccountId: props.fsmParameters.accountId,
          fsmCompanyId: props.fsmParameters.companyId,
        }),
        generateStringKey: "clientSecret",
      },
    });

    NagSuppressions.addResourceSuppressions(clientSecret, [
      {
        id: "AwsSolutions-SMG4",
        reason: "Secret rotation to be managed manually.",
      },
    ]);

    new cdk.CfnOutput(scope, "ClientSecretArn", {
      value: clientSecret.secretArn,
    });

    this.clientSecretArn = clientSecret.secretArn;

    const attachmentBackupFn = new lambda.Function(
      scope,
      "AttachmentBackupFn",
      {
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "index.handler",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "..", "src", "s3-backup")
        ),
        environment: {
          FSM_BASE_URL: props.fsmParameters.sapFsmBaseUrl,
          ATTACHMENT_API_PATH: props.fsmParameters.attachmentApiPath,
          OAUTH2_TOKEN_PATH: props.fsmParameters.oauthTokenPath,
          S3_BUCKET_NAME: bucket.bucketName,
          CLIENT_SECRET_ARN: clientSecret.secretArn,
        },
        timeout: cdk.Duration.seconds(180),
      }
    );
    this.attachmentBackupFn = attachmentBackupFn;
    clientSecret.grantRead(attachmentBackupFn);

    bucket.grantWrite(attachmentBackupFn);
    NagSuppressions.addResourceSuppressions(
      attachmentBackupFn,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "Function needs to be able to write ANY object in the bucket",
          appliesTo: [
            "Action::s3:Abort*",
            "Action::s3:DeleteObject*",
            `Resource::<${cdk.Stack.of(scope).resolve(
              (bucket.node.defaultChild as cdk.CfnElement).logicalId
            )}.Arn>/*`,
          ],
        },
      ],
      true
    );

    const rule = new events.Rule(scope, "WebhookEventRule", {
      eventBus: props.eventBus,
      eventPattern: {
        source: [props.eventSource],
      },
    });

    rule.addTarget(new eventTargets.LambdaFunction(attachmentBackupFn));
  }
}
