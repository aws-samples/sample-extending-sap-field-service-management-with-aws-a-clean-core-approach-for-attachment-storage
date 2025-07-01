// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudtrail from "aws-cdk-lib/aws-cloudtrail";
import * as fs from "fs";
import * as path from "path";
import { FsmParameters } from "./fsm-parameters";
import { NagSuppressions } from "cdk-nag";

export class SapFsmCustomRule extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: {
      apiKeyArn: string;
      clientSecretArn: string;
      apiWebhookUrl: string;
      apiKeyId: string;
      fsmParameters: FsmParameters;
    }
  ) {
    super(scope, id);

    const createBusinessRuleFn = new lambda.Function(
      scope,
      "BusinessRuleCreationFn",
      {
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "index.handler",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "..", "src", "create-custom-rule")
        ),
        environment: {
          FSM_BASE_URL: props.fsmParameters.sapFsmBaseUrl,
          OAUTH2_TOKEN_PATH: props.fsmParameters.oauthTokenPath,
          CLIENT_SECRET_ARN: props.clientSecretArn,
          FSM_CUSTOM_RULE_PATH: props.fsmParameters.businessRuleApiPath,
          FSM_CLIENT_ID: props.fsmParameters.clientId,
          FSM_CLIENT_VERSION: props.fsmParameters.clientVersion,
          FSM_ACCOUNT_ID: props.fsmParameters.accountId,
          FSM_COMPANY_ID: props.fsmParameters.companyId,
          API_KEY_ID: props.apiKeyId,
          API_WEBHOOK_URL: props.apiWebhookUrl,
          STACK_NAME: cdk.Stack.of(this).stackName,
        },
        timeout: cdk.Duration.seconds(180),
      }
    );

    createBusinessRuleFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [props.clientSecretArn],
      })
    );

    createBusinessRuleFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["apigateway:GET"],
        resources: [props.apiKeyArn],
      })
    );

    const trailBucket = new s3.Bucket(this, "CloudTrailLogBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });
    NagSuppressions.addResourceSuppressions(
      [trailBucket],
      [
        {
          id: "AwsSolutions-S1",
          reason: "No need to enable access logging on CloudTrail bucket",
        },
      ]
    );

    if (props.fsmParameters.createNewCloudTrail) {
      new cloudtrail.Trail(this, "SAPTrail", {
        trailName: "SAPSecretsManagerTrail",
        bucket: trailBucket,
        isMultiRegionTrail: false,
        includeGlobalServiceEvents: false,
      });
    }

    const rule = new events.Rule(this, "SecretChangeRule", {
      eventPattern: {
        source: ["aws.secretsmanager"],
        detailType: ["AWS API Call via CloudTrail"],
        detail: {
          eventSource: ["secretsmanager.amazonaws.com"],
          eventName: ["PutSecretValue"], // Trigger on secret update
          requestParameters: {
            secretId: [props.clientSecretArn], // Filter by the specific secret ARN
          },
        },
      },
    });

    rule.addTarget(new targets.LambdaFunction(createBusinessRuleFn));
  }
}
