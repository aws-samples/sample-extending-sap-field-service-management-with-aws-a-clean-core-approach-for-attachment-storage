// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import { NagSuppressions } from "cdk-nag";
import * as fs from "fs";
import * as path from "path";

export class ExtensionBackend extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: {
      api: apigateway.RestApi;
      bucket: s3.Bucket;
      backupFunction: lambda.Function;
      distribution: cloudfront.Distribution;
      sapFsm: {
        accountId: string;
        companyId: string;
        sapFsmBaseUri: string;
        jwksPath: string;
      };
    }
  ) {
    super(scope, id);

    const {
      api,
      bucket,
      backupFunction,
      distribution,
      sapFsm: { accountId, companyId, sapFsmBaseUri, jwksPath },
    } = props;

    const diagramsResource = api.root.addResource("metrics");

    const diagramPresignedUrlFn = new lambda.Function(
      scope,
      "DiagramPresignUrlFn",
      {
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "index.handler",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "..", "src", "cloudwatch-metrics")
        ),
        environment: {
          BUCKET_NAME: bucket.bucketName,
          LAMBDA_FUNCTION_NAME: backupFunction.functionName,
        },
        timeout: cdk.Duration.seconds(180),
      }
    );
    diagramPresignedUrlFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["cloudwatch:GetMetricWidgetImage"],
        resources: ["*"],
      })
    );
    NagSuppressions.addResourceSuppressions(
      diagramPresignedUrlFn,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "The cloudwatch:GetMetricWidgetImage requires resource *",
          appliesTo: ["Resource::*"],
        },
      ],
      true
    );

    const authorizerFn = new lambda.Function(this, "SapTokenAuthorizer", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "..", "/src/jwt-authorizer"),
        {
          bundling: {
            command: [
              "bash",
              "-c",
              "mkdir -p /asset-output/ && npm install && cp -r /asset-input/index.mjs /asset-output/ && cp -r /asset-input/node_modules/ /asset-output/",
            ],
            image: lambda.Runtime.NODEJS_20_X.bundlingImage,
            bundlingFileAccess: cdk.BundlingFileAccess.VOLUME_COPY,
            user: "root",
          },
        }
      ),
      environment: {
        SAP_FSM_BASE_URI: sapFsmBaseUri,
        JWKS_PATH: jwksPath,
        SAP_COMPANY_ID: companyId,
        SAP_ACCOUNT_ID: accountId,
      },
      timeout: cdk.Duration.seconds(5),
    });

    const diagramsMethod = diagramsResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(diagramPresignedUrlFn),
      {
        requestParameters: {},
        apiKeyRequired: false,
        authorizer: new apigateway.TokenAuthorizer(this, "booksAuthorizer", {
          handler: authorizerFn,
        }),
      }
    );

    NagSuppressions.addResourceSuppressions(diagramsMethod, [
      {
        id: "AwsSolutions-COG4",
        reason: "We use a custom authorizer",
      },
    ]);

    distribution.addBehavior(
      "/api/*",
      new cdk.aws_cloudfront_origins.HttpOrigin(
        `${api.restApiId}.execute-api.${cdk.Aws.REGION}.amazonaws.com`,
        {
          originSslProtocols: [cdk.aws_cloudfront.OriginSslPolicy.TLS_V1_2],
          protocolPolicy: cdk.aws_cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        }
      ),
      {
        cachePolicy: new cdk.aws_cloudfront.CachePolicy(
          this,
          `${id}CachePolicy`,
          {
            headerBehavior:
              cdk.aws_cloudfront.CacheHeaderBehavior.allowList("authorization"),
            queryStringBehavior:
              cdk.aws_cloudfront.CacheQueryStringBehavior.all(),
            minTtl: cdk.Duration.seconds(0),
            defaultTtl: cdk.Duration.seconds(0),
            cachePolicyName: `${cdk.Aws.STACK_NAME}${id}${cdk.Aws.REGION}CachePolicy`,
          }
        ),
        originRequestPolicy: new cdk.aws_cloudfront.OriginRequestPolicy(
          this,
          `${id}OriginRequestPolicy`,
          {
            queryStringBehavior:
              cdk.aws_cloudfront.OriginRequestQueryStringBehavior.all(),
            originRequestPolicyName: `${cdk.Aws.STACK_NAME}${id}${cdk.Aws.REGION}OriginRequestPolicy`,
          }
        ),
        responseHeadersPolicy:
          cdk.aws_cloudfront.ResponseHeadersPolicy
            .CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
        allowedMethods: cdk.aws_cloudfront.AllowedMethods.ALLOW_ALL,
        viewerProtocolPolicy:
          cdk.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      }
    );
  }
}
